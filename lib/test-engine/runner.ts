import type {
  TestCase,
  TestRun,
  CaseResult,
  RunStatus,
  WsMessage,
} from "../types";
import type { Environment } from "../config/environments";
import { getUrl, type Platform } from "../config/environments";
import { v4 as uuidv4 } from "uuid";
import { createRun, updateRunStatus, saveCaseResults } from "../db/queries";
import { executeTestCase, type ExecutionResult } from "../mcp-bridge/executor";
import { ensureBridgeRunning } from "../mcp-bridge/lifecycle";
import { createHeadlessPool, type HeadlessPool, type HeadlessWorker } from "./headless-pool";

// ─── Koşum modu ───────────────────────────────────────────────────────────────
// HEADLESS_MODE=false → eski davranış: kullanıcının Chrome'undaki extension
// üzerinden tek bridge ile sıralı koşum.
// Varsayılan (true): worker başına izole headless Chrome + bridge, paralel koşum.
const HEADLESS_MODE = (process.env.HEADLESS_MODE ?? "true").toLowerCase() !== "false";
const PARALLEL_WORKERS = Math.max(
  1,
  Math.min(4, parseInt(process.env.TEST_PARALLEL_WORKERS ?? "2", 10) || 2)
);
import { getTestPlan } from "../tc-planner/planner";
import { loadCasesByIds } from "./parser";
import { postRunSummaryToSlack } from "../notifications/slack";

function notifySlackIfConfigured(runId: string): void {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  postRunSummaryToSlack(runId)
    .then((result) => {
      if (!result.ok && !result.skipped) {
        console.warn(`[runner] Slack bildirimi başarısız (${runId}): ${result.reason}`);
      }
    })
    .catch((err) => {
      console.warn(`[runner] Slack bildirimi hatası (${runId}):`, (err as Error).message);
    });
}

export type BroadcastFn = (runId: string, msg: WsMessage) => void;

// Use global to share the broadcast function across Next.js module instances
// (custom-server.ts sets it, API routes read it from the same global reference)
declare global {
  // eslint-disable-next-line no-var
  var __qa_broadcast: BroadcastFn | undefined;
}

export function setBroadcastFn(fn: BroadcastFn): void {
  global.__qa_broadcast = fn;
}

function _broadcast(runId: string, msg: WsMessage): void {
  if (global.__qa_broadcast) {
    global.__qa_broadcast(runId, msg);
  }
}

// ─── Abort registry ───────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __qa_abort_controllers: Map<string, AbortController> | undefined;
  // eslint-disable-next-line no-var
  var __qa_bridge_queue: string[] | undefined;
}

function getAbortControllers(): Map<string, AbortController> {
  if (!global.__qa_abort_controllers) {
    global.__qa_abort_controllers = new Map();
  }
  return global.__qa_abort_controllers;
}

export function abortRun(runId: string): void {
  const controllers = getAbortControllers();
  const ctrl = controllers.get(runId);
  if (ctrl) {
    ctrl.abort();
    controllers.delete(runId);
  }
}

export function getActiveRunIds(): Set<string> {
  return new Set(getAbortControllers().keys());
}

// ─── Bridge execution queue ───────────────────────────────────────────────────
// Bridge tek-tenant: aynı anda yalnız 1 case işleyebilir. Bu kuyruk runner'ın
// `executeTestCase` çağrılarını sıraya koyduğu ham sırasını yansıtır.
// queue[0] = şu anda bridge'in işlediği run.
// queue[1..] = bridge için bekleyen run'lar (HTTP POST hâlâ await'de).

function getBridgeQueue(): string[] {
  if (!global.__qa_bridge_queue) {
    global.__qa_bridge_queue = [];
  }
  return global.__qa_bridge_queue;
}

export function getBridgeQueueSnapshot(): string[] {
  return [...getBridgeQueue()];
}

function enqueueBridgeWait(runId: string): void {
  getBridgeQueue().push(runId);
}

function dequeueBridgeWait(runId: string): void {
  const queue = getBridgeQueue();
  const idx = queue.indexOf(runId);
  if (idx >= 0) queue.splice(idx, 1);
}

export interface RunOptions {
  name: string;
  cases: TestCase[];
  environment: Environment;
  runType: TestRun["runType"];
  triggeredBy?: "manual" | "scheduled";
  /** If provided, only run on these platforms (overrides per-case platform list) */
  selectedPlatforms?: Platform[];
}

export async function startRun(opts: RunOptions): Promise<string> {
  // Legacy modda bridge'i lazy başlat. Headless modda havuz kendi bridge'lerini
  // kurar (runCasesAsync içinde) — burada beklemeye gerek yok.
  if (!HEADLESS_MODE) {
    try {
      await ensureBridgeRunning();
    } catch (err) {
      throw new Error(
        `Page Agent bridge başlatılamadı: ${(err as Error).message}. ` +
          `Manuel başlatmayı deneyin: npm run bridge`
      );
    }
  }

  const runId = uuidv4();
  const now = new Date().toISOString();

  const run: Omit<TestRun, "passedCases" | "failedCases"> = {
    id: runId,
    name: opts.name,
    environment: opts.environment,
    runType: opts.runType,
    status: "running",
    totalCases: opts.cases.length,
    startedAt: now,
    triggeredBy: opts.triggeredBy ?? "manual",
  };

  createRun(run);

  // Pre-register the AbortController so the stop API can abort it immediately
  const ctrl = new AbortController();
  getAbortControllers().set(runId, ctrl);

  // Run asynchronously — don't block response
  runCasesAsync(runId, opts, ctrl.signal).catch((err) => {
    getAbortControllers().delete(runId);
    console.error(`[runner] Run ${runId} crashed:`, err);
    updateRunStatus(runId, "failed", 0, opts.cases.length, new Date().toISOString());
  });

  return runId;
}

interface WorkItem {
  testCase: TestCase;
  platform: string;
}

function buildWorkItems(opts: RunOptions): WorkItem[] {
  const items: WorkItem[] = [];
  for (const testCase of opts.cases) {
    const platforms = opts.selectedPlatforms?.length
      ? testCase.platform.filter((p) => opts.selectedPlatforms!.includes(p as Platform))
      : testCase.platform;
    const effectivePlatforms = platforms.length > 0 ? platforms : testCase.platform;
    for (const platform of effectivePlatforms) {
      items.push({ testCase, platform });
    }
  }
  return items;
}

async function runCasesAsync(runId: string, opts: RunOptions, signal: AbortSignal): Promise<void> {
  let passed = 0;
  let failed = 0;
  let infraStop = false;
  let infraMessage = "";

  // In-memory accumulator — nothing is written to DB until the run finishes
  const finishedResults: CaseResult[] = [];
  const queue = buildWorkItems(opts);

  // ── Headless havuzu kur (başarısız olursa legacy sıralı moda düş) ─────────
  let pool: HeadlessPool | null = null;
  if (HEADLESS_MODE && queue.length > 0) {
    const size = Math.min(PARALLEL_WORKERS, queue.length);
    try {
      _broadcast(runId, {
        type: "log",
        payload: { message: `[runner] 🚀 Headless havuz kuruluyor (${size} paralel worker)...` },
      });
      pool = await createHeadlessPool(size);
      _broadcast(runId, {
        type: "log",
        payload: { message: `[runner] ✅ ${size} headless Chrome hazır — testler paralel koşuyor` },
      });
    } catch (err) {
      console.warn(`[runner] Headless havuz kurulamadı, legacy moda düşülüyor: ${(err as Error).message}`);
      _broadcast(runId, {
        type: "log",
        payload: {
          message: `[runner] ⚠ Headless havuz kurulamadı (${(err as Error).message.split("\n")[0]}) — extension'lı sıralı moda düşüldü`,
        },
      });
      pool = null;
    }
  }
  if (!pool) {
    try {
      await ensureBridgeRunning();
    } catch (err) {
      throw new Error(`Bridge başlatılamadı: ${(err as Error).message}`);
    }
  }

  // ── Tek work item'ı koşan yürütücü (worker'lı veya legacy) ────────────────
  const executeOne = async (item: WorkItem, worker: HeadlessWorker | null): Promise<void> => {
    const { testCase, platform } = item;
    const targetUrl = getUrl(opts.environment, platform as Platform);
    const caseResultId = uuidv4();
    const executedAt = new Date().toISOString();

    _broadcast(runId, {
      type: "case_start",
      payload: { caseResultId, caseId: testCase.id, title: testCase.title, platform },
    });

    _broadcast(runId, {
      type: "step_update",
      payload: {
        caseResultId,
        step: {
          index: 0,
          description:
            `▶ ${testCase.title} — ${platform.toUpperCase()} → ${targetUrl}` +
            (worker ? `  [worker ${worker.id}]` : ""),
          status: "running" as const,
          timestamp: new Date().toISOString(),
        },
      },
    });

    // Headless worker'da hub kopmuşsa (MV3 SW askıya alınması) önce kendini onar
    if (worker) {
      try {
        await worker.ensureConnected();
      } catch (err) {
        console.warn(`[runner] Worker ${worker.id} yeniden bağlanamadı: ${(err as Error).message}`);
      }
    }

    enqueueBridgeWait(runId);
    let result: ExecutionResult;
    try {
      result = await executeTestCase({
        runId,
        caseResultId,
        testCase,
        environment: opts.environment,
        platform: platform as Platform,
        signal,
        bridgeBase: worker?.bridgeBase,
        onStep: (step) => {
          if (!signal.aborted) {
            _broadcast(runId, { type: "step_update", payload: { caseResultId, step } });
          }
        },
        onAnomaly: (anomaly) => {
          if (!signal.aborted) {
            _broadcast(runId, { type: "anomaly", payload: { caseResultId, anomaly } });
          }
        },
      });
    } finally {
      dequeueBridgeWait(runId);
    }

    const status = signal.aborted ? "failed" : result.success ? "success" : "failed";
    result.success && !signal.aborted ? passed++ : failed++;

    // Hata aldıysa ekran görüntüsünü ekle (headless modda puppeteer'dan direkt)
    if (status === "failed" && worker) {
      const shotPath = await worker.captureFailureScreenshot(testCase.id, runId);
      if (shotPath) {
        _broadcast(runId, {
          type: "screenshot_taken",
          payload: { caseResultId, caseId: testCase.id, path: shotPath },
        });
      }
    }

    finishedResults.push({
      id: caseResultId,
      runId,
      caseId: testCase.id,
      platform: platform as CaseResult["platform"],
      status,
      steps: result.steps,
      anomalies: result.anomalies,
      errorMessage: signal.aborted ? "Kullanıcı tarafından durduruldu" : result.errorMessage,
      durationMs: result.durationMs,
      executedAt,
    });

    if (!signal.aborted) {
      _broadcast(runId, {
        type: "case_end",
        payload: {
          caseResultId,
          caseId: testCase.id,
          status,
          durationMs: result.durationMs,
          steps: result.steps,
          anomalies: result.anomalies,
        },
      });
    }

    // LLM/bridge altyapı hatası — kalan case'leri koşmak anlamsız
    if (result.isInfraError && !infraStop) {
      infraStop = true;
      infraMessage = result.errorMessage?.split("\n")[0] ?? "";
      console.error(`[runner] ⛔ Altyapı hatası — run durduruluyor. Hata: ${infraMessage}`);
      _broadcast(runId, {
        type: "log",
        payload: { message: `[runner] ⛔ LLM bağlantı hatası — run durduruldu. ${infraMessage}` },
      });
    }
  };

  try {
    if (pool) {
      // Paralel: her worker kuyruktan iş çeker, kuyruk bitene dek koşar
      await Promise.all(
        pool.workers.map(async (worker) => {
          for (;;) {
            if (signal.aborted || infraStop) break;
            const item = queue.shift();
            if (!item) break;
            await executeOne(item, worker);
          }
        })
      );
    } else {
      // Legacy: tek bridge, sıralı
      for (;;) {
        if (signal.aborted || infraStop) break;
        const item = queue.shift();
        if (!item) break;
        await executeOne(item, null);
      }
    }
  } finally {
    if (pool) await pool.dispose();
  }

  getAbortControllers().delete(runId);

  const finalStatus: RunStatus = signal.aborted || infraStop
    ? "failed"
    : failed === 0 ? "success" : passed === 0 ? "failed" : "partial";

  const finishedAt = new Date().toISOString();

  // ── Single DB flush at the very end ──────────────────────────────────────
  saveCaseResults(finishedResults);
  updateRunStatus(runId, finalStatus, passed, failed, finishedAt);

  _broadcast(runId, {
    type: "run_end",
    payload: { runId, status: finalStatus, passed, failed },
  });

  notifySlackIfConfigured(runId);
}

// ─── Plan-based run ───────────────────────────────────────────────────────────

export async function runWithPlan(
  planId: string,
  opts: Omit<RunOptions, "cases">
): Promise<string> {
  const plan = getTestPlan(planId);
  if (!plan) throw new Error(`Test planı bulunamadı: ${planId}`);

  const orderedIds = plan.priority
    .sort((a, b) => a.priority - b.priority)
    .map((p) => p.testCaseId);

  const cases = loadCasesByIds(orderedIds);
  // Preserve plan order
  const orderedCases = orderedIds
    .map((id) => cases.find((c) => c.id === id))
    .filter((c): c is TestCase => c !== undefined);

  const runId = await startRun({
    ...opts,
    cases: orderedCases,
    name: opts.name ?? `Plan Run — ${planId.slice(0, 8)}`,
  });

  // Broadcast plan metadata after starting
  _broadcast(runId, {
    type: "log",
    payload: {
      message: `[tc-planner] Plan ${planId} ile çalıştırılıyor: ${orderedCases.length} TC`,
    },
  });

  return runId;
}
