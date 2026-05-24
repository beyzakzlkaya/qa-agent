/**
 * lib/jira-pipeline/jira-runner.ts
 *
 * Ana pipeline orchestrator.
 * Adım 0-3 paralel çalışır, ardından mevcut test engine'i kullanır.
 * Run bitince JIRA'ya rapor yazar:
 *   - Tüm testler geçtiyse → RTR
 *   - Herhangi bir test başarısızsa → IN PROGRESS
 */

import type { PipelineOptions, PrAnalysis, TestCase } from "../types";
import { loadContext } from "./context-cache";
import { fetchJiraTask } from "./jira-fetcher";
import { analyzePRSafe } from "./pr-analyzer";
import { generateTestCases } from "./test-generator";
import { reportToJira } from "./reporter";
import { transitionIssue } from "./api-clients";
import { startRun } from "../test-engine/runner";
import { getCaseResultsByRun, getRun, recordJiraIteration } from "../db/queries";

export interface PipelineResult {
  runId: string;
  taskKey: string;
  caseCount: number;
  prUrl?: string;
}

export interface GenerateOnlyResult {
  taskKey: string;
  cases: TestCase[];
  prUrl?: string;
  prAnalysis?: PrAnalysis;
}

// ── Run completion watcher ─────────────────────────────────────────────────────

async function waitForRunCompletion(
  runId: string,
  timeoutMs = 30 * 60 * 1000
): Promise<void> {
  const start = Date.now();
  const poll = 5_000;

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, poll));
    const run = getRun(runId);
    if (!run) break;
    if (run.status !== "running") return;
  }
}

async function postRunReport(
  runId: string,
  taskKey: string,
  prUrl?: string
): Promise<void> {
  try {
    await waitForRunCompletion(runId);
    const run = getRun(runId);
    if (!run) return;

    const caseResults = getCaseResultsByRun(runId);

    await reportToJira({
      taskKey,
      prUrl,
      runId,
      caseResults,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? new Date().toISOString(),
      runStatus: run.status,
    });

    // Başarılı → RTR, Başarısız → IN PROGRESS
    const allPassed =
      run.status === "success" &&
      caseResults.every((r) => r.status === "success");

    const targetStatus = allPassed ? "RTR" : "IN PROGRESS";

    await transitionIssue(taskKey, targetStatus).catch((err) =>
      console.warn(
        `[jira-runner] ${targetStatus} geçişi başarısız: ${(err as Error).message}`
      )
    );

    console.log(
      `[jira-runner] ${taskKey} → ${targetStatus} (${allPassed ? "tüm testler geçti" : "başarısız test var"})`
    );
  } catch (err) {
    console.error("[jira-runner] Post-run rapor hatası:", (err as Error).message);
  }
}

/**
 * Called by the execute API route after starting a run from the preview screen.
 * Schedules the post-run comment + RTR transition without blocking.
 */
export function schedulePostRunActions(
  runId: string,
  taskKey: string,
  prUrl?: string
): void {
  postRunReport(runId, taskKey, prUrl).catch((err) =>
    console.error("[jira-runner] schedulePostRunActions hatası:", err)
  );
}

// ── Generate Only (test caseler üretilir ama çalıştırılmaz) ───────────────────

export async function generateOnlyPipeline(
  opts: PipelineOptions
): Promise<GenerateOnlyResult> {
  const { taskKey } = opts;

  console.log(`\n[jira-pipeline] ═══ Generate-only pipeline: ${taskKey} ═══`);

  const [ctx, jiraTask] = await Promise.all([
    loadContext(),
    fetchJiraTask(taskKey),
  ]);

  const pr = await analyzePRSafe(jiraTask.prUrl);

  const { cases } = await generateTestCases(jiraTask, pr, ctx);

  if (cases.length === 0) {
    throw new Error(
      `${taskKey} için test case üretilemedi. LLM yanıtını kontrol edin.`
    );
  }

  console.log(
    `[jira-pipeline] ${cases.length} test case üretildi (generate-only)`
  );

  return {
    taskKey,
    cases,
    prUrl: jiraTask.prUrl,
    prAnalysis: pr ?? undefined,
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runJiraPipeline(
  opts: PipelineOptions
): Promise<PipelineResult> {
  const { taskKey, environment, runType = "regression" } = opts;

  console.log(`\n[jira-pipeline] ═══ Pipeline başlıyor: ${taskKey} ═══`);

  const [ctx, jiraTask] = await Promise.all([
    loadContext(),
    fetchJiraTask(taskKey),
  ]);

  const pr = await analyzePRSafe(jiraTask.prUrl);

  const { cases } = await generateTestCases(jiraTask, pr, ctx);

  if (cases.length === 0) {
    throw new Error(
      `${taskKey} için test case üretilemedi. LLM yanıtını kontrol edin.`
    );
  }

  const runName = `[JIRA] ${taskKey}: ${jiraTask.summary.slice(0, 60)}`;
  const runId = await startRun({
    name: runName,
    cases,
    environment,
    runType,
    triggeredBy: "manual",
  });

  console.log(
    `[jira-pipeline] Run başlatıldı: ${runId} | ${cases.length} test | env: ${environment}`
  );

  // İterasyon kaydı — detay sayfasında "Önceki QA İterasyonları" için
  try {
    recordJiraIteration(runId, taskKey);
  } catch (err) {
    console.warn(`[jira-runner] iteration kaydı atlandı: ${(err as Error).message}`);
  }

  // Transition to IN QA immediately
  transitionIssue(taskKey, "IN QA").catch((err) =>
    console.warn(`[jira-runner] IN QA geçişi başarısız: ${(err as Error).message}`)
  );

  // Post comment + transition to RTR or IN PROGRESS when done (non-blocking)
  schedulePostRunActions(runId, taskKey, jiraTask.prUrl);

  return {
    runId,
    taskKey,
    caseCount: cases.length,
    prUrl: jiraTask.prUrl,
  };
}
