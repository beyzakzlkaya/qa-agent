/**
 * lib/mcp-bridge/executor.ts
 *
 * Drives the PageAgent bridge (scripts/start-bridge.ts) for a single test case.
 *
 * Architecture:
 *   Next.js runner → executeTestCase() → HTTP POST /execute → Bridge (38401)
 *                                      ↑ parallel
 *                                      GET /events (SSE) → onStep() callbacks
 *                                      ↓ after completion
 *                                      WS result → success/fail
 *
 * Steps come EXCLUSIVELY from the SSE stream.
 * The final result blob is only used for success/fail determination.
 */

import http from "http";
import type { TestCase, TestStep, Anomaly, Platform } from "../types";
import type { Environment } from "../config/environments";
import { getUrl } from "../config/environments";
import { getSystemPromptData } from "../config/system-prompt";
import { getLlmConfig } from "./hub-wrapper";
import { detectAnomaliesFromSteps } from "../test-engine/anomaly-detector";
import { buildPageAgentTask, sanitizePrompt } from "../prompt-builder/index";
import { injectTemplateVars } from "../config/system-prompt";
import { buildDomainContext } from "../domain-agent/context-builder";
import {
  logStep,
  logAnomaly,
  logBridgeExecute,
  logError,
  logInfo,
} from "../logger";

const BRIDGE_PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401", 10);
const BRIDGE_BASE = `http://localhost:${BRIDGE_PORT}`;

// ─── SSE event types from bridge ──────────────────────────────────────────────

interface BridgeStepEvent {
  stepIndex?: number;
  reflection?: {
    next_goal?: string;
    evaluation_previous_goal?: string;
    memory?: string;
  };
  action?: {
    name?: string;
    input?: unknown;
    output?: string;
  };
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  timestamp?: string;
}

// ─── Action icon map ──────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, string> = {
  go_to_url: "🌐",
  click: "🖱",
  input_text: "⌨",
  fill: "⌨",
  type: "⌨",
  scroll: "↕",
  wait: "⏳",
  screenshot: "📸",
  extract_content: "📋",
  done: "✅",
  search: "🔍",
  select: "📝",
  hover: "👆",
  key_press: "⌨",
  tab_close: "✖",
  tab_open: "➕",
  navigate_back: "⬅",
  navigate_forward: "➡",
};

// ─── SSE event → TestStep ─────────────────────────────────────────────────────

function bridgeEventToTestStep(
  event: BridgeStepEvent,
  index: number
): TestStep | null {
  let goal = "";
  let actionPart = "";

  if (event.reflection?.next_goal) {
    goal = event.reflection.next_goal.slice(0, 300);
  }

  // Defensive unwrap: older bridge builds emit events where action.name is the
  // raw page-agent tool name "AgentOutput" and the real sub-action / reflection
  // live nested inside action.input. Pull them out so the UI shows the actual
  // step (e.g. "🌐 go to url") instead of "▶ AgentOutput".
  let eventAction = event.action;
  if (eventAction?.name === "AgentOutput" && eventAction.input && typeof eventAction.input === "object") {
    const inp = eventAction.input as Record<string, unknown>;

    if (!goal) {
      const cs = (inp.current_state && typeof inp.current_state === "object")
        ? (inp.current_state as Record<string, unknown>)
        : {};
      const nextGoal = inp.next_goal ?? cs.next_goal;
      const thinking = inp.thinking ?? cs.thinking;
      if (typeof nextGoal === "string" && nextGoal) {
        goal = nextGoal.slice(0, 300);
      } else if (typeof thinking === "string" && thinking) {
        goal = thinking.slice(0, 300);
      }
    }

    let inner: Record<string, unknown> | undefined;
    if (Array.isArray(inp.action)) {
      inner = (inp.action as Record<string, unknown>[])[0];
    } else if (inp.action && typeof inp.action === "object") {
      inner = inp.action as Record<string, unknown>;
    }
    if (inner) {
      if (typeof inner.name === "string") {
        eventAction = { name: inner.name, input: inner.input as Record<string, unknown> | undefined, output: eventAction.output };
      } else {
        const innerName = Object.keys(inner).find((k) => k !== "name" && k !== "input");
        if (innerName) {
          eventAction = { name: innerName, input: inner[innerName] as Record<string, unknown> | undefined, output: eventAction.output };
        } else {
          eventAction = undefined;
        }
      }
    } else {
      eventAction = undefined;
    }
  }

  if (eventAction?.name) {
    const name = eventAction.name;
    const icon = ACTION_ICONS[name] ?? "▶";
    const label = name.replace(/_/g, " ");
    let detail = "";

    if (eventAction.input && typeof eventAction.input === "object") {
      const inp = eventAction.input as Record<string, unknown>;
      const val =
        inp.url ??
        inp.selector ??
        inp.text ??
        inp.query ??
        inp.value ??
        inp.keys ??
        inp.index;
      if (val !== undefined) detail = ` "${String(val).slice(0, 120)}"`;
    }

    // For done() actions capture the output message
    if (name === "done" && eventAction.output) {
      detail = ` → ${String(eventAction.output).slice(0, 150)}`;
    }

    actionPart = `${icon} ${label}${detail}`;
  }

  let description = "";
  if (goal && actionPart) {
    description = `${goal}\n  ${actionPart}`;
  } else if (goal) {
    description = goal;
  } else if (actionPart) {
    description = actionPart;
  } else if (event.reflection?.evaluation_previous_goal) {
    description = event.reflection.evaluation_previous_goal.slice(0, 250);
  } else if (eventAction) {
    description = `▶ ${JSON.stringify(eventAction).slice(0, 200)}`;
  } else if (event.reflection) {
    description = JSON.stringify(event.reflection).slice(0, 200);
  }

  if (!description.trim()) {
    description = `⚙️ agent step: ${JSON.stringify(event).slice(0, 120)}`;
  }

  // Infer step status from action name / output
  const actionOutput = String(eventAction?.output ?? "").toLowerCase();
  const actionName = eventAction?.name ?? "";

  const isDoneFailure =
    actionName === "done" &&
    (actionOutput.includes("fail") ||
      actionOutput.includes("false") ||
      actionOutput.includes("başarısız"));

  // Detect silent failures: explicit error text in action output.
  //
  // IMPORTANT: do NOT treat "null" or "false" raw strings as failures here.
  // execute_script() legitimately returns "null" (e.g. localStorage.getItem()
  // on a missing key) and "false" (boolean checks). Marking those as failures
  // would terminate tests prematurely before the agent has a chance to react.
  // Only flag outputs that contain actual error phrasing.
  const isSilentFailure =
    actionOutput.includes("silent failure") ||
    actionOutput.includes("action failed") ||
    actionOutput.includes("element not found") ||
    actionOutput.includes("not interactable") ||
    actionOutput.includes("not clickable") ||
    actionOutput.includes("element not visible") ||
    actionOutput.includes("no such element") ||
    description.toLowerCase().includes("silent failure");

  const stepFailed = isDoneFailure || isSilentFailure;

  return {
    index,
    description: description.trim(),
    status: stepFailed ? "failed" : "success",
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
}

// ─── SSE stream consumer ──────────────────────────────────────────────────────

/**
 * Opens the bridge GET /events SSE endpoint and converts each event to a
 * TestStep, firing onStep() immediately. Reconnects automatically on drop.
 * Stops cleanly when signal is aborted.
 */
async function streamBridgeSteps(
  bridgeBase: string,
  startIndex: number,
  signal: AbortSignal,
  onStep: (step: TestStep) => void,
  getLastStepTs: () => number
): Promise<void> {
  let idx = startIndex + 1;
  let firstConnect = true;
  let reconnectCount = 0;

  console.log(`[executor] 📡 SSE stream başlatılıyor → ${bridgeBase}/events`);

  while (!signal.aborted) {
    try {
      const res = await fetch(`${bridgeBase}/events`, { signal });
      if (!res.body) {
        console.warn(`[executor] ⚠ SSE /events yanıt body'si boş — durduruluyor`);
        break;
      }

      if (firstConnect) {
        firstConnect = false;
        console.log(`[executor] ✅ SSE stream bağlandı ✓`);
        onStep({
          index: startIndex,
          description: "🔌 Agent bağlantısı kuruldu, görev başlatılıyor...",
          status: "success",
          timestamp: new Date().toISOString(),
        });
      } else {
        reconnectCount++;
        console.log(`[executor] 🔄 SSE stream yeniden bağlandı (${reconnectCount}. kez)`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        if (signal.aborted) {
          reader.cancel();
          console.log(`[executor] 📡 SSE stream iptal sinyali alındı — kapatılıyor`);
          break;
        }
        const { done, value } = await reader.read();
        if (done || signal.aborted) {
          console.log(`[executor] 📡 SSE stream kapandı (done=${done})`);
          break;
        }

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const ev: BridgeStepEvent = JSON.parse(json);
            const actionName = ev.action?.name ?? "";
            const goal = ev.reflection?.next_goal?.slice(0, 60) ?? "";
            console.log(
              `[executor] 📥 SSE event alındı | idx=${idx}` +
              (actionName ? ` action=${actionName}` : "") +
              (goal ? ` goal="${goal}"` : "")
            );
            const stepArrivalTs = Date.now();
            const durationSinceLastStep = stepArrivalTs - getLastStepTs();
            const step = bridgeEventToTestStep(ev, idx);
            if (step) {
              step.durationMs = durationSinceLastStep;
              idx++;
              console.log(
                `[executor]   ⏱ step #${step.index} durationMs=${durationSinceLastStep}ms` +
                (actionName ? ` action=${actionName}` : "")
              );
              onStep(step);
            } else {
              console.log(`[executor]   (event boş adıma dönüştü — atlanıyor)`);
            }
          } catch (parseErr) {
            console.warn(`[executor] ⚠ SSE event parse hatası: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
          }
        }
      }
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        console.log(`[executor] 📡 SSE stream AbortError — temiz kapatma`);
        break;
      }
      console.warn(`[executor] ⚠ SSE bağlantı hatası: ${err instanceof Error ? err.message : String(err)} — 1s sonra yeniden denenecek`);
      // Brief pause before reconnect
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(`[executor] 📡 SSE stream döngüsü sonlandı (toplam SSE eventi: ${idx - startIndex - 1})`);
}

// ─── ExecutionContext ─────────────────────────────────────────────────────────

export interface ExecutionContext {
  runId: string;
  caseResultId: string;
  testCase: TestCase;
  environment: Environment;
  platform: Platform;
  signal?: AbortSignal;
  onStep: (step: TestStep) => void;
  onAnomaly: (anomaly: Anomaly) => void;
  /** Paralel/headless koşumda worker'a özel bridge adresi (örn. http://localhost:38402). */
  bridgeBase?: string;
}

export interface ExecutionResult {
  success: boolean;
  steps: TestStep[];
  anomalies: Anomaly[];
  errorMessage?: string;
  durationMs: number;
  /** LLM/bridge altyapı hatası — true ise diğer case'lere geçme, run'ı durdur */
  isInfraError?: boolean;
}

// ─── Bridge connection check ──────────────────────────────────────────────────

async function waitForBridge(timeoutMs = 10_000, base = BRIDGE_BASE): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  console.log(`[executor] 🔌 Bridge bağlantısı bekleniyor (${base}, maks ${timeoutMs / 1000}s)...`);
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(`${base}/status`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = (await res.json()) as { connected: boolean };
        console.log(`[executor]   Deneme ${attempt}: HTTP ${res.status} connected=${data.connected}`);
        if (data.connected) {
          console.log(`[executor] ✅ Bridge bağlandı (${attempt}. denemede)`);
          return;
        }
      } else {
        console.log(`[executor]   Deneme ${attempt}: HTTP ${res.status} — bekleniyor...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[executor]   Deneme ${attempt}: ulaşılamadı (${msg.slice(0, 60)}) — bekleniyor...`);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(
    `Page Agent bağlantısı ${timeoutMs / 1000}s içinde kurulamadı.\n` +
      `• "npm run bridge" çalışıyor mu?\n` +
      `• Chrome'da Page Agent Extension açık mı?\n` +
      `• http://localhost:${BRIDGE_PORT} adresini Chrome'da açın`
  );
}

// ─── Hub idle wait ────────────────────────────────────────────────────────────

async function waitForHubFree(timeoutMs = 45_000, base = BRIDGE_BASE): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const start = Date.now();
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = (await res.json()) as { connected?: boolean; busy?: boolean };
        if (!data.busy) {
          console.log(`[executor] ✅ Hub boşaldı (${Date.now() - start}ms bekledik)`);
          return;
        }
        console.log(`[executor] ⏳ Hub meşgul — busy=${data.busy} (${Date.now() - start}ms geçti)`);
      }
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`[executor] ⚠ Hub ${timeoutMs / 1000}s içinde boşalmadı — yine de devam ediliyor`);
}

// ─── Bridge HTTP helper (no undici timeout) ───────────────────────────────────

type BridgeResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/**
 * HTTP POST to a local bridge endpoint using Node.js http.request().
 * Global fetch() uses undici, which has a 300s headersTimeout + 300s bodyTimeout.
 * Long-running /execute tasks easily exceed these — http.request() has no such
 * built-in timeouts, so we control lifecycle entirely via AbortSignal.
 */
function bridgePost(url: string, body: unknown, signal?: AbortSignal): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    }

    const parsed = new URL(url);
    const bodyStr = JSON.stringify(body);

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port) : 80,
        path: parsed.pathname + (parsed.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => {
              try { return Promise.resolve(JSON.parse(text)); }
              catch { return Promise.reject(new Error(`Invalid JSON: ${text.slice(0, 100)}`)); }
            },
          });
        });
        res.on("error", reject);
      }
    );

    req.on("error", reject);

    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.once("close", () => signal.removeEventListener("abort", onAbort));
    }

    req.write(bodyStr);
    req.end();
  });
}

// ─── Error classifiers ────────────────────────────────────────────────────────

function isHtmlJsonError(msg: string): boolean {
  return (
    msg.includes("<!doctype") ||
    msg.includes("<!DOCTYPE") ||
    msg.includes("Unexpected token '<'") ||
    msg.includes("is not valid JSON")
  );
}

function buildHtmlJsonErrorMessage(originalMsg: string): string {
  return (
    `LLM API JSON yerine HTML döndürdü.\n\n` +
    `Orijinal hata: ${originalMsg}\n\n` +
    `Olası nedenler:\n` +
    `  1. API anahtarı (LLM_API_KEY) geçersiz veya ayarlanmamış\n` +
    `  2. LLM_BASE_URL yanlış — https://api.anthropic.com/v1 olmalı\n` +
    `  3. "npm run bridge" çalışmıyor (bridge Anthropic proxy'yi yönetiyor)`
  );
}

function isRateLimitError(msg: string): boolean {
  return /rate.?limit|quota|exceeded.*quota|429|too.?many.?request/i.test(msg);
}

function buildRateLimitErrorMessage(originalMsg: string): string {
  return (
    `API Kota Sınırı Aşıldı (Rate Limit)\n\n` +
    `Orijinal hata: ${originalMsg}\n\n` +
    `Çözüm seçenekleri:\n` +
    `  1. OpenAI/Anthropic hesabınızın kredi/kota durumunu kontrol edin\n` +
    `  2. Birkaç dakika bekleyip tekrar deneyin\n` +
    `  3. .env.local dosyasında farklı bir API anahtarı (LLM_API_KEY) deneyin\n` +
    `  4. Daha düşük token limitli bir model (LLM_MODEL_NAME) kullanmayı deneyin`
  );
}

// ─── Success determination ────────────────────────────────────────────────────

/**
 * Determines test pass/fail from the bridge result.
 *
 * Priority:
 *  1. done(false) SSE step → always false
 *  2. Any SSE step flagged as "silent failure" → false
 *  3. Bridge explicit success=true → true (unless step signals contradict)
 *  4. Bridge success=false + resultData keyword scan:
 *     - If agent text contains explicit done(true) language → treat as partial navigation success
 *       but still return false (bridge is authoritative)
 *     - Always false when bridge=false
 */
function determineSuccess(
  bridgeSuccess: boolean,
  resultData: string,
  sseSteps: TestStep[]
): boolean {
  // 1. Explicit done(false) in any step → hard failure regardless of bridge flag
  const doneFailStep = sseSteps.find(
    (s) =>
      s.status === "failed" &&
      (s.description.includes("✅ done") ||
        s.description.toLowerCase().includes("done →") ||
        s.description.toLowerCase().includes("done(false") ||
        s.description.toLowerCase().includes("silent failure"))
  );
  if (doneFailStep) return false;

  // 2. Bridge says failure → respect it. The agent summary text is unreliable:
  //    agents commonly say "I navigated successfully" even when subsequent actions failed.
  //    The bridge success flag reflects whether done(true) was actually called.
  if (!bridgeSuccess) return false;

  // 3. Bridge says success — check SSE steps for any step that explicitly failed
  const hasFailedStep = sseSteps.some((s) => s.status === "failed");
  if (hasFailedStep) return false;

  return true;
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function executeTestCase(
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  const bridgeBase = ctx.bridgeBase ?? BRIDGE_BASE;
  const startTime = Date.now();
  const steps: TestStep[] = [];
  const anomalies: Anomaly[] = [];
  let sseAbort = new AbortController();
  let ssePromise: Promise<void> = Promise.resolve();

  if (ctx.signal?.aborted) {
    return { success: false, steps, anomalies, errorMessage: "İptal edildi", durationMs: 0 };
  }

  ctx.signal?.addEventListener("abort", () => {
    try { sseAbort.abort(); } catch { /* ignore */ }
  }, { once: true });

  // Wrapper that logs + calls callback
  const addStep = (step: Omit<TestStep, "index">): TestStep => {
    const s = { ...step, index: steps.length };
    steps.push(s);
    ctx.onStep(s);
    logStep(ctx.runId, ctx.caseResultId, s);
    return s;
  };

  // SSE steps come with their own index from bridge; we capture them separately
  const sseSteps: TestStep[] = [];
  let lastStepTs = Date.now();
  const onSseStep = (step: TestStep): void => {
    lastStepTs = Date.now();
    sseSteps.push(step);
    ctx.onStep(step);
    logStep(ctx.runId, ctx.caseResultId, step);
  };

  // Abort reason tracking — set before execAbort.abort() to identify who triggered it
  let abortReason: "caller" | null = null;

  try {
    // 1. Resolve root URL and prompt
    const sysData = getSystemPromptData();
    const rootUrl = getUrl(ctx.environment, ctx.platform);
    const resolvedPrompt = sanitizePrompt(
      injectTemplateVars(ctx.testCase.prompt, sysData)
    );

    logInfo(
      `Test başlatılıyor: ${ctx.testCase.title} | ${ctx.platform} | ${ctx.environment}`,
      ctx.runId
    );

    addStep({
      description: `${ctx.platform.toUpperCase()} platformu başlatılıyor → ${rootUrl}`,
      status: "running",
      timestamp: new Date().toISOString(),
    });

    // 2. Wait for bridge + extension
    addStep({
      description: "Page Agent bağlantısı doğrulanıyor...",
      status: "running",
      timestamp: new Date().toISOString(),
    });
    await waitForBridge(10_000, bridgeBase);
    steps[steps.length - 1].status = "success";
    steps[steps.length - 1].description = "Page Agent bağlandı ✓";
    ctx.onStep(steps[steps.length - 1]);

    // Clean up any lingering previous task before proceeding
    try {
      await fetch(`${bridgeBase}/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(2000),
      });
      console.log(`[executor] 🧹 Önceki task temizlendi`);
    } catch { /* stop endpoint olmayabilir */ }

    // 3. LLM config
    const llmConfig = getLlmConfig();
    if (!llmConfig) {
      throw new Error(
        ".env.local dosyasında LLM yapılandırması eksik.\n" +
          "LLM_BASE_URL, LLM_API_KEY ve LLM_MODEL_NAME değerlerini ayarlayın."
      );
    }
    console.log(`[executor] 🤖 LLM config yüklendi | model=${llmConfig.model} baseURL=${llmConfig.baseURL}`);

    // 4. Build professional task prompt via prompt-builder
    const domainContext = await buildDomainContext(
      `${ctx.testCase.title} ${resolvedPrompt.slice(0, 200)}`
    ).catch(() => "");

    const fullTask = buildPageAgentTask({
      ctx,
      resolvedPrompt,
      rootUrl,
      sysData,
      domainContext: domainContext || undefined,
    });

    addStep({
      description: `🌐 Görev hazırlandı → ${rootUrl} (${llmConfig.model})`,
      status: "running",
      timestamp: new Date().toISOString(),
    });

    // 5. Start SSE listener in parallel
    // Wait for hub to be idle first — prevents "Hub is busy" race between sequential cases
    await waitForHubFree(45_000, bridgeBase);
    sseAbort = new AbortController();
    const sseStartIndex = steps.length;
    ssePromise = streamBridgeSteps(
      bridgeBase,
      sseStartIndex,
      sseAbort.signal,
      onSseStep,
      () => lastStepTs
    );

    // 6. Pre-navigate the browser tab to rootUrl BEFORE starting the agent.
    // The extension always starts on whatever tab is currently active (e.g. localhost:3000).
    // Sending /navigate first ensures the agent sees the correct page from step 0.
    addStep({
      description: `🌐 Hedef sayfaya yönlendiriliyor: ${rootUrl}`,
      status: "running",
      timestamp: new Date().toISOString(),
    });

    try {
      await fetch(`${bridgeBase}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rootUrl }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Non-fatal: extension may not support standalone navigate — proceed anyway
    }

    // Wait for the page to load before the agent starts
    await new Promise((r) => setTimeout(r, 800));

    steps[steps.length - 1].status = "success";
    steps[steps.length - 1].description = `🌐 Hedef sayfaya yönlendirildi: ${rootUrl} ✓`;
    ctx.onStep(steps[steps.length - 1]);

    // 7. Execute via bridge
    const execAbort = new AbortController();

    const onCallerAbort = () => {
      abortReason = "caller";
      execAbort.abort();
      try { sseAbort.abort(); } catch { /* ignore */ }
    };
    ctx.signal?.addEventListener("abort", onCallerAbort, { once: true });

    // Routing logic:
    //  - baseURL starts with "bedrock://"     → Bedrock  → /bedrock-proxy (bridge SDK çağrısı)
    //  - apiPath === "/api/chat"               → native Ollama  → ollama-chat-compat (format dönüşümü)
    //  - apiPath set but not /api/chat         → OpenAI-compat  → ollama-proxy (OLLAMA_BASE_URL'e doğrudan proxy)
    //  - apiPath not set                       → OpenAI / Anthropic → baseURL as-is (bridge /execute handler yönlendirir)
    const isBedrockProvider = llmConfig.baseURL.startsWith("bedrock://");
    const isOllamaNative = !isBedrockProvider && llmConfig.apiPath === "/api/chat";
    const isOllamaOpenAICompat = !isBedrockProvider && !!llmConfig.apiPath && !isOllamaNative;
    const effectiveBaseURL = isBedrockProvider
      ? `${bridgeBase}/bedrock-proxy/v1`
      : isOllamaNative
      ? `${bridgeBase}/ollama-chat-compat`
      : isOllamaOpenAICompat
      ? `${bridgeBase}/ollama-proxy${llmConfig.apiPath}`
      : llmConfig.baseURL;

    const bridgePayload = {
      task: fullTask,
      startUrl: rootUrl,
      runId: ctx.runId,
      caseId: ctx.caseResultId,
      config: {
        apiKey: llmConfig.apiKey,
        baseURL: effectiveBaseURL,
        model: llmConfig.model,
        maxSteps: 25,
        stepTimeoutMs: 15000,
        waitAfterActionMs: 800,
        language: "en-US",

        // PageAgent bekleme stratejisi — SPA/checkout sayfaları için optimize
        waitForNetworkIdle: false,
        actionDelay: 300,
        navigationTimeout: 10000,
        waitAfterNavigation: 500,
        stabilityThreshold: 300,
      },
    };

    const HARD_TIMEOUT_MS = 10 * 60 * 1000;
    const hardTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(Object.assign(
          new Error("Executor hard timeout: 10 dakika aşıldı"),
          { name: "TimeoutError" }
        )),
        HARD_TIMEOUT_MS
      )
    );

    let execRes!: BridgeResponse;
    const bridgeCallStart = Date.now();

    console.log(
      `\n[executor] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `[executor] 📤 Bridge'e POST /execute gönderiliyor\n` +
      `[executor]   run=${ctx.runId} case=${ctx.caseResultId}\n` +
      `[executor]   model=${llmConfig.model}  maxSteps=${bridgePayload.config.maxSteps}\n` +
      `[executor]   startUrl=${rootUrl}\n` +
      `[executor]   task (ilk 100): ${fullTask.slice(0, 100)}…\n` +
      `[executor] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );

    const BRIDGE_FETCH_RETRIES = 2;
    let lastFetchError: Error | null = null;
    for (let attempt = 1; attempt <= BRIDGE_FETCH_RETRIES; attempt++) {
      try {
        execRes = await Promise.race([
          bridgePost(`${bridgeBase}/execute`, bridgePayload, execAbort.signal),
          hardTimeoutPromise,
        ]);
        lastFetchError = null;
        break;
      } catch (fetchErr) {
        lastFetchError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
        const isTimeout = lastFetchError.name === "TimeoutError";
        const isAbort = lastFetchError.name === "AbortError";
        const abortSource = isAbort
          ? (abortReason === "caller"
              ? " (kullanıcı durdurdu)"
              : ` (execAbort — sebep: ${abortReason ?? "bilinmiyor"})`)
          : "";
        console.error(
          `[executor] ❌ Bridge /execute fetch hatası (deneme ${attempt}/${BRIDGE_FETCH_RETRIES})` +
          ` | ${lastFetchError.message}${abortSource}` +
          ` | url=${bridgeBase}/execute run=${ctx.runId}`
        );
        if (isTimeout) {
          try { sseAbort.abort(); } catch { /* ignore */ }
          try {
            await fetch(`${bridgeBase}/stop`, {
              method: "POST",
              signal: AbortSignal.timeout(2000),
            });
          } catch { /* ignore */ }
          break;
        }
        if (isAbort || ctx.signal?.aborted) break;
        if (attempt < BRIDGE_FETCH_RETRIES) {
          const delay = attempt * 2000;
          console.log(`[executor] ⏳ ${delay}ms sonra tekrar denenecek...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    try {
      if (lastFetchError) throw lastFetchError;
    } finally {
      ctx.signal?.removeEventListener("abort", onCallerAbort);
      try { sseAbort.abort(); } catch { /* ignore */ }
      await ssePromise;
    }

    const resultBody = (await execRes.json()) as {
      success?: boolean;
      data?: string;
      error?: string;
    };

    const bridgeDuration = Date.now() - bridgeCallStart;
    console.log(
      `[executor] 📥 Bridge /execute yanıtı alındı | HTTP=${execRes.status} süre=${bridgeDuration}ms` +
      ` success=${resultBody.success ?? "?"} SSEadım=${sseSteps.length}`
    );

    // Bridge now flushes 200 headers immediately for long-poll requests, so errors
    // arrive as HTTP 200 with { success: false, error: "..." } in the body.
    // Also keep the original !execRes.ok check for early bridge errors (503, 400).
    const isBodyError = !execRes.ok || (!resultBody.success && !!resultBody.error);
    const bodyErrMsg = resultBody.error ?? resultBody.data ?? (execRes.ok ? undefined : `Bridge hatası: HTTP ${execRes.status}`);

    // "Hub is busy" retry: extension briefly stays busy after completing the previous task.
    // Wait for it to become idle and re-submit once before treating it as a real failure.
    if (isBodyError && (bodyErrMsg ?? "").includes("Hub is busy") && !ctx.signal?.aborted) {
      console.warn(`[executor] ⏳ Hub meşgul hatası alındı — hub boşalınca tekrar denenecek...`);
      await waitForHubFree(45_000, bridgeBase);

      // Restart SSE for the retry attempt
      sseAbort = new AbortController();
      ssePromise = streamBridgeSteps(
        bridgeBase,
        sseSteps.length + steps.length,
        sseAbort.signal,
        onSseStep,
        () => lastStepTs
      );

      let retryFetchErr: Error | null = null;
      let retryRes!: BridgeResponse;
      try {
        retryRes = await bridgePost(`${bridgeBase}/execute`, bridgePayload, execAbort.signal);
      } catch (e) {
        retryFetchErr = e instanceof Error ? e : new Error(String(e));
      } finally {
        try { sseAbort.abort(); } catch { /* ignore */ }
        await ssePromise;
      }

      if (retryFetchErr) throw retryFetchErr;
      execRes = retryRes;
      const retryBody = (await execRes.json()) as { success?: boolean; data?: string; error?: string };
      Object.assign(resultBody, retryBody);
      console.log(`[executor] 🔄 Hub meşgul retry tamamlandı | HTTP=${execRes.status} success=${retryBody.success ?? "?"}`);
    }

    // "Extension disconnected mid-task" retry: hub closed the WS while the task was running.
    // Wait up to 60s for it to reconnect, then re-submit the task once.
    const isDisconnectError = isBodyError && (
      (bodyErrMsg ?? "").includes("bağlantısı kesildi") ||
      (bodyErrMsg ?? "").includes("disconnected") ||
      (bodyErrMsg ?? "").includes("Chrome Extension bağlantısı")
    );
    if (isDisconnectError && !ctx.signal?.aborted) {
      console.warn(
        `[executor] ⚡ Extension bağlantısı görev sırasında kesildi — yeniden bağlanması bekleniyor...\n` +
        `[executor]   Hata: ${(bodyErrMsg ?? "").split("\n")[0]}\n` +
        `[executor]   run=${ctx.runId} case=${ctx.caseResultId} SSEadım=${sseSteps.length}`
      );
      await waitForHubFree(60_000, bridgeBase);

      console.log(`[executor] 🔄 Hub yeniden bağlandı — görev sıfırdan tekrar gönderiliyor...`);

      sseAbort = new AbortController();
      ssePromise = streamBridgeSteps(
        bridgeBase,
        sseSteps.length + steps.length,
        sseAbort.signal,
        onSseStep,
        () => lastStepTs
      );

      let retryFetchErr2: Error | null = null;
      let retryRes2!: BridgeResponse;
      try {
        retryRes2 = await bridgePost(`${bridgeBase}/execute`, bridgePayload, execAbort.signal);
      } catch (e) {
        retryFetchErr2 = e instanceof Error ? e : new Error(String(e));
      } finally {
        try { sseAbort.abort(); } catch { /* ignore */ }
        await ssePromise;
      }

      if (retryFetchErr2) throw retryFetchErr2;
      execRes = retryRes2;
      const retryBody2 = (await execRes.json()) as { success?: boolean; data?: string; error?: string };
      Object.assign(resultBody, retryBody2);
      console.log(`[executor] 🔄 Extension disconnect retry tamamlandı | HTTP=${execRes.status} success=${retryBody2.success ?? "?"}`);
    }

    // Re-evaluate after potential retry
    const finalIsBodyError = !execRes.ok || (!resultBody.success && !!resultBody.error);
    if (finalIsBodyError) {
      const errMsg = resultBody.error ?? resultBody.data ?? `Bridge hatası: HTTP ${execRes.status}`;

      logBridgeExecute({
        runId: ctx.runId,
        caseId: ctx.caseResultId,
        task: fullTask,
        startUrl: rootUrl,
        model: llmConfig.model,
        success: false,
        resultSummary: errMsg.slice(0, 200),
        durationMs: bridgeDuration,
        error: errMsg.slice(0, 500),
      });

      throw new Error(errMsg);
    }

    const result = {
      success: resultBody.success ?? false,
      data: resultBody.data ?? "",
    };

    // Log bridge execution result
    logBridgeExecute({
      runId: ctx.runId,
      caseId: ctx.caseResultId,
      task: fullTask,
      startUrl: rootUrl,
      model: llmConfig.model,
      success: result.success,
      resultSummary: result.data.slice(0, 300),
      durationMs: bridgeDuration,
    });

    // 7. Determine final success from all signals
    const allSteps = [...steps, ...sseSteps];
    const success = determineSuccess(result.success, result.data, sseSteps);
    const totalDurationMs = Date.now() - startTime;
    console.log(
      `[executor] 🏁 Sonuç belirlendi | bridge=${result.success} finalSuccess=${success}` +
      ` toplamAdım=${allSteps.length} (SSE=${sseSteps.length} manuel=${steps.length})\n` +
      `[executor] ⏱ Süre özeti | toplam=${totalDurationMs}ms  LLM+pageAgent(bridge)=${bridgeDuration}ms  setup=${totalDurationMs - bridgeDuration}ms`
    );

    // 8. If test failed, request a screenshot from the extension
    if (!success) {
      try {
        await fetch(`${bridgeBase}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "take_screenshot",
            testCaseId: ctx.testCase.id,
            stepIndex: sseSteps.length,
            label: "fail",
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Screenshot alınamazsa testi engelleme
      }
    }

    // 9. Detect anomalies from structured SSE steps (not regex on text)
    const detected = detectAnomaliesFromSteps(sseSteps, result.success, result.data);
    if (detected.length > 0) {
      console.log(`[executor] ⚠ ${detected.length} anomali tespit edildi`);
    }
    for (const anomaly of detected) {
      anomalies.push(anomaly);
      ctx.onAnomaly(anomaly);
      logAnomaly(ctx.runId, ctx.caseResultId, anomaly);
    }

    // 10. Final summary step
    const setupDurationMs = totalDurationMs - bridgeDuration;
    const timingNote =
      `  [⏱ toplam=${totalDurationMs}ms | LLM+agent=${bridgeDuration}ms | setup=${setupDurationMs}ms | ${sseSteps.length} SSE adım]`;
    addStep({
      description: (success
        ? `✅ Test başarıyla tamamlandı — ${result.data.slice(0, 200)}`
        : `❌ Test başarısız — ${result.data.slice(0, 200)}`) + `\n${timingNote}`,
      status: success ? "success" : "failed",
      durationMs: totalDurationMs,
      timestamp: new Date().toISOString(),
    });

    return {
      success,
      steps: allSteps,
      anomalies,
      errorMessage: success ? undefined : result.data.slice(0, 500),
      durationMs: totalDurationMs,
    };
  } catch (err) {
    try { sseAbort.abort(); } catch { /* ignore */ }
    const raw = err instanceof Error ? err : new Error(String(err));
    const cause = (raw as NodeJS.ErrnoException).cause;
    const causeMsg = cause instanceof Error ? ` | cause: ${cause.message}` : "";

    console.error(
      `[executor] ❌ Test exception | ${raw.name}: ${raw.message}${causeMsg}` +
      ` | run=${ctx.runId} case=${ctx.caseResultId}`
    );

    if (raw.name === "TimeoutError") {
      console.error(
        `[executor] ⏰ Hard timeout tetiklendi | run=${ctx.runId} case=${ctx.caseResultId}`
      );
      addStep({
        description: "Test zaman aşımına uğradı (4 dakika hard cap).",
        status: "failed",
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        steps: [...steps, ...sseSteps],
        anomalies,
        errorMessage: raw.message,
        durationMs: Date.now() - startTime,
      };
    }

    if (raw.name === "AbortError" || ctx.signal?.aborted) {
      const isCallerStop = abortReason === "caller" || ctx.signal?.aborted;
      const isUnexpectedAbort = !isCallerStop;

      const reason = isCallerStop
        ? "Kullanıcı tarafından durduruldu"
        : `Beklenmedik iptal — abortReason=${abortReason ?? "null"}, ctx.signal.aborted=${ctx.signal?.aborted ?? false}`;

      console.warn(`[executor] ⚠ Test iptal | ${reason} | run=${ctx.runId} case=${ctx.caseResultId}`);

      addStep({
        description: isUnexpectedAbort
          ? `Test beklenmedik şekilde iptal edildi (${raw.message}).`
          : "Test kullanıcı tarafından durduruldu.",
        status: "failed",
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        steps: [...steps, ...sseSteps],
        anomalies,
        errorMessage: isUnexpectedAbort
          ? `Beklenmedik iptal: ${raw.message}`
          : "İptal edildi",
        durationMs: Date.now() - startTime,
      };
    }

    const friendlyMsg = isHtmlJsonError(raw.message)
      ? buildHtmlJsonErrorMessage(raw.message)
      : isRateLimitError(raw.message)
      ? buildRateLimitErrorMessage(raw.message)
      : raw.message;

    logError(friendlyMsg, ctx.runId, {
      caseId: ctx.caseResultId,
      testCase: ctx.testCase.id,
    });

    addStep({
      description: friendlyMsg.split("\n")[0],
      status: "failed",
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      steps: [...steps, ...sseSteps],
      anomalies,
      errorMessage: friendlyMsg,
      durationMs: Date.now() - startTime,
      isInfraError: isHtmlJsonError(raw.message) || isRateLimitError(raw.message),
    };
  }
}
