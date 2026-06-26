#!/usr/bin/env ts-node
/**
 * scripts/start-bridge.ts
 *
 * Architecture:
 *   QA Agent UI → HTTP → Bridge (:38401) → WebSocket → Chrome Extension → Target Tab
 *
 * Endpoints:
 *   GET  /          → launcher.html (extension bağlantısını tetikler)
 *   GET  /status    → { connected, busy }
 *   POST /execute   → long-poll, task'ı extension'a gönderir, sonucu bekler
 *   POST /stop      → mevcut görevi durdurur
 *   GET  /events    → SSE: gerçek zamanlı adım akışı
 *   ANY  /anthropic-proxy/* → api.anthropic.com proxy (tool_choice fix + headers)
 *   ANY  /openai-proxy/*    → api.openai.com proxy
 *   GET  /logs/:runId → JSONL log dosyası (structured request/step logs)
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

// ── Load .env.local ────────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    process.env[key] = val;
  }
  console.log("[bridge] .env.local yüklendi");
}

const PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401", 10);
const EXT_ID = process.env.PAGE_AGENT_EXT_ID || "akldabonmimlicnjlflnapfeklbfemhj";
const STORE_URL = `https://chromewebstore.google.com/detail/page-agent-ext/${EXT_ID}`;
const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const OPENAI_API_BASE = "https://api.openai.com";
const _llmProvider = process.env.LLM_PROVIDER?.trim() ?? "anthropic";
const OLLAMA_API_BASE = _llmProvider === "ollama-local"
  ? (process.env.OLLAMA_LOCAL_BASE_URL ?? "http://localhost:11434")
  : (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434");
const OLLAMA_API_KEY = _llmProvider === "ollama-local"
  ? "ollama"
  : (process.env.OLLAMA_API_KEY ?? "");
const OLLAMA_API_PATH = _llmProvider === "ollama-local"
  ? (process.env.OLLAMA_LOCAL_API_PATH ?? "/v1")
  : (process.env.OLLAMA_API_PATH ?? "/api/chat");
const OLLAMA_DEFAULT_MODEL = _llmProvider === "ollama-local"
  ? (process.env.OLLAMA_LOCAL_DEFAULT_MODEL ?? "llama3.2")
  : (process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.2");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
const LOG_DIR = path.join(process.cwd(), "data", "logs");

// ── AWS Bedrock ────────────────────────────────────────────────────────────────
const BEDROCK_REGION = process.env.AWS_BEDROCK_REGION ?? "eu-west-1";
const BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID ?? "arn:aws:bedrock:eu-west-1:878897830229:application-inference-profile/ke6nevjhqyoo";
let _bedrockClient: BedrockRuntimeClient | null = null;
function getBedrockClient(): BedrockRuntimeClient {
  if (!_bedrockClient) {
    _bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  }
  return _bedrockClient;
}

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch { /* non-fatal */ }

// Log aktif provider
const _activeProvider = _llmProvider === "ollama" || _llmProvider === "ollama-local"
  ? _llmProvider
  : _llmProvider === "bedrock"
  ? "bedrock"
  : _llmProvider === "anthropic"
  ? "anthropic"
  : _llmProvider === "openai"
  ? "openai"
  : OPENAI_API_KEY ? "openai" : "anthropic";
const _ollamaBase = OLLAMA_API_BASE;
console.log(`[bridge] Aktif provider: ${_activeProvider}` + (
  _activeProvider === "ollama" || _activeProvider === "ollama-local"
    ? ` (${_ollamaBase} | model: ${OLLAMA_DEFAULT_MODEL})`
    : _activeProvider === "bedrock"
    ? ` (region=${BEDROCK_REGION} | model: ${BEDROCK_MODEL_ID})`
    : _activeProvider === "openai"
    ? ` (OPENAI_API_KEY mevcut ✓)`
    : ` (OPENAI_API_KEY yok — Anthropic kullanılacak)`
));
const STRIP_PARAMS = new Set(["verbosity"]);

// ── Launcher HTML ──────────────────────────────────────────────────────────────
// __dirname = scripts/ → ../server/launcher.html = server/launcher.html
// Fallback: process.cwd() is the project root when run via npm
const launcherHtmlPath = path.join(
  typeof __dirname !== "undefined" ? path.join(__dirname, "..") : process.cwd(),
  "server/launcher.html"
);
let launcherHtml = `<!doctype html><html><body>
<p>Page Agent Bridge çalışıyor — port ${PORT}</p>
<p>Extension bağlanıyor...</p>
<script>
  chrome.runtime.sendMessage('${EXT_ID}',
    { type: 'OPEN_HUB', wsPort: ${PORT}, token: '' },
    (r) => { if (!r?.ok) document.body.innerHTML += '<p style="color:red">Extension bulunamadı. <a href="${STORE_URL}">Yükle</a></p>' }
  );
</script></body></html>`;

try {
  if (fs.existsSync(launcherHtmlPath)) {
    launcherHtml = fs.readFileSync(launcherHtmlPath, "utf-8")
      .replaceAll("__EXT_ID__", EXT_ID)
      .replaceAll("__STORE_URL__", STORE_URL)
      .replaceAll("__WS_PORT__", String(PORT))
      .replaceAll("__TOKEN__", "");
  }
} catch {
  // use inline fallback
}

// ── State ──────────────────────────────────────────────────────────────────────
let hubWs: WebSocket | null = null;
let pendingTask: { resolve: (r: unknown) => void; reject: (e: Error) => void; runId?: string } | null = null;
let sseClients: http.ServerResponse[] = [];
let stepCounter = 0;
// Track current run context for logging
let currentRunId = "unknown";
let currentCaseId = "unknown";
// Extension'a config göndermek, useAgent.ts içindeki React useEffect[config]'i tetikler
// ve agent.dispose() race condition'ı yüzünden ilk execute hep "Task aborted" döner.
// Çözüm: her config değişikliğinde bir defaya mahsus "priming" execute yollanır
// (chrome.storage.local'a config'i yazdırır), sonra gerçek execute config'siz gider.
// Bkz: alibaba/page-agent packages/extension/src/agent/useAgent.ts:70-108
let primedConfigSignature: string | null = null;
let warmupResolver: (() => void) | null = null;
// Priming sonrası gelen geç result'lar gerçek execute'a karışmasın diye sayaç.
// Priming send → +1, result/error swallow → -1, safety timeout → resetlenmez (geç gelen yine yutulur).
let pendingPrimerResponses = 0;

function hubConnected(): boolean {
  return hubWs?.readyState === WebSocket.OPEN;
}

// ── Structured bridge logger ───────────────────────────────────────────────────

interface BridgeLogEntry {
  type: "llm_proxy" | "step" | "execute" | "connection" | "error";
  ts: string;
  runId: string;
  caseId?: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  requestSizeBytes?: number;
  responseStatus?: number;
  responseSizeBytes?: number;
  durationMs?: number;
  stepIndex?: number;
  action?: string;
  goal?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
  error?: string;
  message?: string;
}

function writeBridgeLog(entry: BridgeLogEntry): void {
  try {
    const runId = entry.runId || "unknown";
    const logFile = path.join(LOG_DIR, `${runId}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

/** Push hub connection state to the Next.js UI via its internal API route. */
function notifyUI(state: { connected: boolean; busy: boolean }): void {
  fetch("http://localhost:3000/api/internal/hub-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  }).catch(() => {/* UI may not be running yet */});
}

function broadcastStep(step: unknown) {
  const payload = `data: ${JSON.stringify(step)}\n\n`;
  sseClients = sseClients.filter((client) => {
    try { client.write(payload); return true; } catch { return false; }
  });
}

// Page-agent's AgentOutput tool ships reflection (evaluation_previous_goal /
// memory / next_goal / thinking) plus an `action` field. Across page-agent
// versions the shape drifts: action may be an array (`[{open_tab:{...}}]`) or a
// single keyed object (`{open_tab:{...}}`), and reflection fields may live at
// the top level or under a `current_state` wrapper. unwrapAgentOutput
// normalises all of these into ({reflection, action}) so SSE consumers always
// see a meaningful step description instead of a bare "AgentOutput" label.
function unwrapAgentOutput(
  args: Record<string, unknown>,
  outputLabel: string
): { reflection?: Record<string, string>; action?: Record<string, unknown> } {
  const cs = (args.current_state && typeof args.current_state === "object")
    ? (args.current_state as Record<string, unknown>)
    : {};

  const evalPrev = args.evaluation_previous_goal ?? cs.evaluation_previous_goal;
  const memory = args.memory ?? cs.memory;
  const nextGoal = args.next_goal ?? cs.next_goal;
  const thinking = args.thinking ?? cs.thinking;

  const hasReflection =
    evalPrev !== undefined ||
    memory !== undefined ||
    nextGoal !== undefined ||
    thinking !== undefined;

  let reflection: Record<string, string> | undefined;
  if (hasReflection) {
    reflection = {
      evaluation_previous_goal: String(evalPrev ?? ""),
      memory: String(memory ?? ""),
      next_goal: String(nextGoal ?? (thinking ? String(thinking).slice(0, 300) : "")),
    };
  }

  // action shape: array of {tool:input}, single {tool:input}, or {name, input}
  let actionObj: Record<string, unknown> | undefined;
  if (Array.isArray(args.action)) {
    actionObj = (args.action as Record<string, unknown>[])[0];
  } else if (args.action && typeof args.action === "object") {
    actionObj = args.action as Record<string, unknown>;
  }

  let action: Record<string, unknown> | undefined;
  if (actionObj) {
    if (typeof actionObj.name === "string") {
      action = {
        name: actionObj.name,
        input: (actionObj.input as Record<string, unknown>) ?? {},
        output: outputLabel,
      };
    } else {
      const actionName = Object.keys(actionObj).find((k) => k !== "name" && k !== "input");
      if (actionName) {
        action = {
          name: actionName,
          input: (actionObj[actionName] as Record<string, unknown>) ?? {},
          output: outputLabel,
        };
      }
    }
  }

  return { reflection, action };
}

function extractStep(responseJson: Record<string, unknown>, stepIndex: number) {
  try {
    // ── OpenAI format: { choices: [{ message: { tool_calls, content }, finish_reason }] }
    const choices = responseJson?.choices as Array<Record<string, unknown>> | undefined;
    if (choices?.length) {
      const choice = choices[0];
      const msg = choice.message as Record<string, unknown>;
      const toolCalls = msg?.tool_calls as Array<Record<string, unknown>>;
      const toolCall = toolCalls?.[0];
      const usage = responseJson.usage as Record<string, number> | undefined;

      let reflection: Record<string, string> | undefined;
      let action: Record<string, unknown> | undefined;

      if (toolCall) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String((toolCall.function as Record<string, string>)?.arguments ?? "{}")); } catch { /**/ }

        const toolName = (toolCall.function as Record<string, string>)?.name ?? "unknown";
        const isAgentOutput =
          toolName === "AgentOutput" ||
          "next_goal" in args ||
          "evaluation_previous_goal" in args ||
          "current_state" in args ||
          "thinking" in args ||
          "action" in args;

        if (isAgentOutput) {
          const unwrapped = unwrapAgentOutput(args, String(choice.finish_reason ?? ""));
          reflection = unwrapped.reflection;
          action = unwrapped.action;
        } else {
          action = {
            name: toolName,
            input: args,
            output: String(choice.finish_reason ?? ""),
          };
        }
      } else if (msg?.content) {
        reflection = { evaluation_previous_goal: "", memory: "", next_goal: String(msg.content).slice(0, 300) };
      }

      const tokenUsage = usage ? {
        prompt: usage.prompt_tokens ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      } : undefined;

      // Log this LLM proxy call
      writeBridgeLog({
        type: "llm_proxy",
        ts: new Date().toISOString(),
        runId: currentRunId,
        caseId: currentCaseId,
        provider: "openai",
        stepIndex,
        action: action ? String((action.name as string) ?? "") : undefined,
        goal: reflection?.next_goal?.slice(0, 120),
        tokenUsage,
      });

      return {
        stepIndex,
        reflection,
        action,
        usage: tokenUsage ? {
          promptTokens: tokenUsage.prompt,
          completionTokens: tokenUsage.completion,
          totalTokens: tokenUsage.total,
        } : undefined,
        timestamp: new Date().toISOString(),
      };
    }

    // ── Anthropic format: { content: [{ type: "tool_use"|"text", ... }], usage: { input_tokens, output_tokens } }
    const content = responseJson?.content as Array<Record<string, unknown>> | undefined;
    if (content?.length) {
      const usage = responseJson.usage as Record<string, number> | undefined;
      let reflection: Record<string, string> | undefined;
      let action: Record<string, unknown> | undefined;

      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = String(block.name ?? "unknown");
          const toolInput = (block.input ?? {}) as Record<string, unknown>;

          const isAgentOutput =
            toolName === "AgentOutput" ||
            "next_goal" in toolInput ||
            "evaluation_previous_goal" in toolInput ||
            "current_state" in toolInput ||
            "thinking" in toolInput ||
            "action" in toolInput;

          if (isAgentOutput) {
            const unwrapped = unwrapAgentOutput(toolInput, "tool_use");
            reflection = unwrapped.reflection;
            action = unwrapped.action;
          } else {
            action = { name: toolName, input: toolInput, output: "tool_use" };
          }
          break;
        } else if (block.type === "text" && block.text) {
          reflection = { evaluation_previous_goal: "", memory: "", next_goal: String(block.text).slice(0, 300) };
        }
      }

      if (!reflection && !action) return null;

      const tokenUsage = usage ? {
        prompt: usage.input_tokens ?? 0,
        completion: usage.output_tokens ?? 0,
        total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      } : undefined;

      // Log this LLM proxy call
      writeBridgeLog({
        type: "llm_proxy",
        ts: new Date().toISOString(),
        runId: currentRunId,
        caseId: currentCaseId,
        provider: "anthropic",
        stepIndex,
        action: action ? String((action.name as string) ?? "") : undefined,
        goal: reflection?.next_goal?.slice(0, 120),
        tokenUsage,
      });

      return {
        stepIndex,
        reflection,
        action,
        usage: tokenUsage ? {
          promptTokens: tokenUsage.prompt,
          completionTokens: tokenUsage.completion,
          totalTokens: tokenUsage.total,
        } : undefined,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Ollama native /api/chat ↔ OpenAI compat köprüsü ──────────────────────────
// Chrome extension OpenAI formatında istek gönderir. Bu fonksiyon:
//   1. OpenAI request → Ollama /api/chat request formatına çevirir
//   2. Ollama yanıtını → OpenAI response formatına çevirir
function handleOllamaChat(req: http.IncomingMessage, res: http.ServerResponse) {
  const proxyCallStart = Date.now();
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", () => {
    let messages: { role: string; content: string }[] = [];
    let model = OLLAMA_DEFAULT_MODEL;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (Array.isArray(parsed.messages)) {
        messages = parsed.messages as { role: string; content: string }[];
      }
      if (typeof parsed.model === "string" && parsed.model) model = parsed.model;
    } catch { /* use defaults */ }

    // Ollama native request
    const ollamaBody = JSON.stringify({ model, messages, stream: false });
    const ollamaBodyBytes = Buffer.from(ollamaBody);
    const targetUrl = new URL(OLLAMA_API_PATH, OLLAMA_API_BASE);
    const isHttps = targetUrl.protocol === "https:";
    const requestLib = isHttps ? https : http;

    console.log(`[bridge] 🤖 Ollama /api/chat isteği | model=${model} boyut=${ollamaBodyBytes.length}B run=${currentRunId}`);

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: isHttps ? (parseInt(targetUrl.port) || 443) : (parseInt(targetUrl.port) || 80),
      path: targetUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": ollamaBodyBytes.length,
        ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
      },
    };

    const proxyReq = requestLib.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        const durationMs = Date.now() - proxyCallStart;
        const statusCode = proxyRes.statusCode ?? 200;

        if (statusCode === 200) {
          try {
            const ollamaJson = JSON.parse(responseBody.toString("utf-8")) as {
              message?: { role: string; content: string };
              model?: string;
              done?: boolean;
            };
            // OpenAI compat response
            const openAiResponse = {
              id: `ollama-${Date.now()}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: ollamaJson.model ?? model,
              choices: [{
                index: 0,
                message: {
                  role: "assistant",
                  content: ollamaJson.message?.content ?? "",
                },
                finish_reason: "stop",
              }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
            const openAiBytes = Buffer.from(JSON.stringify(openAiResponse));
            console.log(`[bridge] ✅ Ollama yanıtı alındı | model=${model} ${durationMs}ms`);
            const step = extractStep(openAiResponse as unknown as Record<string, unknown>, stepCounter++);
            if (step) {
              broadcastStep(step);
              const goal = (step.reflection as Record<string, string> | undefined)?.next_goal ?? "";
              if (goal) console.log(`[bridge] 📍 Adım ${step.stepIndex}: ${goal.slice(0, 80)}`);
            }
            res.writeHead(200, { "Content-Type": "application/json", "Content-Length": openAiBytes.length, "Access-Control-Allow-Origin": "*" });
            res.end(openAiBytes);
          } catch (parseErr) {
            console.warn(`[bridge] ⚠ Ollama yanıtı parse edilemedi: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Ollama response parse error" } }));
          }
        } else {
          const errText = responseBody.toString("utf-8").slice(0, 300);
          console.error(`[bridge] ⚠ Ollama hata: HTTP ${statusCode} | ${durationMs}ms\n  ${errText}`);
          res.writeHead(statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(responseBody);
        }
      });
    });

    proxyReq.on("error", (err: Error) => {
      console.error(`[bridge] ✗ Ollama bağlantı hatası: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: err.message, code: "OLLAMA_PROXY_ERROR" } }));
      }
    });

    proxyReq.write(ollamaBodyBytes);
    proxyReq.end();
  });
}

// ── Generic LLM proxy ─────────────────────────────────────────────────────────
function handleProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  apiBase: string,
  apiKey: string,
  urlPrefix: string,
  extraHeaders?: Record<string, string>,
  bodyTransform?: (parsed: Record<string, unknown>) => void
) {
  const targetPath = (req.url ?? "").replace(new RegExp(`^${urlPrefix}`), "");
  const proxyCallStart = Date.now();
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", () => {
    let rawBody = body;
    let parsedModel = "unknown";
    if (body) {
      try {
        const parsed: Record<string, unknown> = JSON.parse(body);
        for (const key of STRIP_PARAMS) delete parsed[key];
        bodyTransform?.(parsed);
        // gpt-5.x, o1, o3 serisi max_tokens parametresini desteklemiyor — bu modellerde enjekte etme
        const modelName = typeof parsed.model === "string" ? parsed.model : "";
        const noMaxTokensModels = /^(gpt-5|o1|o3|o4)/i;
        if (!parsed.max_tokens && !noMaxTokensModels.test(modelName)) parsed.max_tokens = 8192;
        // Ollama local: context window'u genişlet (varsayılan 4096 prompt'u keser)
        if (_llmProvider === "ollama-local") {
          const opts = (parsed.options as Record<string, unknown> | undefined) ?? {};
          if (!opts.num_ctx) opts.num_ctx = 32768;
          parsed.options = opts;
        }
        if (typeof parsed.model === "string") parsedModel = parsed.model;
        rawBody = JSON.stringify(parsed);
      } catch { /* forward as-is */ }
    }

    const incomingAuth = (req.headers["authorization"] as string) ?? "";
    const bodyBytes = Buffer.from(rawBody);
    const targetUrl = new URL(targetPath, apiBase);
    const providerLabel = urlPrefix.includes("anthropic") ? "anthropic" : urlPrefix.includes("ollama") ? _llmProvider : "openai";

    console.log(
      `[bridge] 🤖 AI isteği gönderiliyor | provider=${providerLabel} model=${parsedModel}` +
      ` step=${stepCounter} boyut=${bodyBytes.length}B` +
      ` run=${currentRunId}`
    );

    const isHttp = targetUrl.protocol === "http:";
    const requestLib = isHttp ? http : https;

    // Anthropic uses x-api-key (added via extraHeaders), NOT Authorization: Bearer.
    // Only add Authorization header for non-Anthropic providers.
    const isAnthropicProvider = urlPrefix.includes("anthropic");
    const authHeader = isAnthropicProvider
      ? undefined
      : apiKey ? `Bearer ${apiKey}` : incomingAuth || undefined;

    const baseHeaders: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Content-Length": bodyBytes.length,
      ...extraHeaders,
    };
    if (authHeader) {
      baseHeaders["Authorization"] = authHeader;
    }

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: isHttp ? (parseInt(targetUrl.port) || 80) : 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: baseHeaders,
      ...(isHttp ? {} : { agent: new https.Agent({ keepAlive: false }) }),
    };

    const proxyReq = requestLib.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        const durationMs = Date.now() - proxyCallStart;
        const statusCode = proxyRes.statusCode ?? 200;

        if (statusCode === 200) {
          console.log(
            `[bridge] ✅ AI cevabı alındı | provider=${providerLabel} model=${parsedModel}` +
            ` HTTP=${statusCode} ${durationMs}ms yanıt=${responseBody.length}B`
          );
          if (sseClients.length > 0) {
            try {
              const json = JSON.parse(responseBody.toString("utf-8")) as Record<string, unknown>;

              // Token kullanımını logla
              const usage = json.usage as Record<string, number> | undefined;
              if (usage) {
                const inputT = usage.input_tokens ?? usage.prompt_tokens ?? 0;
                const outputT = usage.output_tokens ?? usage.completion_tokens ?? 0;
                console.log(`[bridge]   token: giriş=${inputT} çıkış=${outputT} toplam=${inputT + outputT}`);
              }

              const step = extractStep(json, stepCounter++);
              if (step) {
                broadcastStep(step);
                const goal = (step.reflection as Record<string, string> | undefined)?.next_goal ?? "";
                const actionName = (step.action as Record<string, string> | undefined)?.name ?? "";
                if (goal || actionName) {
                  console.log(`[bridge] 📍 Adım ${step.stepIndex}: ${actionName ? `[${actionName}] ` : ""}${goal.slice(0, 80)}`);
                }
              } else {
                console.log(`[bridge]   (adım çıkarılamadı — ham yanıt türü: ${typeof json.type ?? "?"} finish=${(json.choices as Array<Record<string,unknown>>)?.[0]?.finish_reason ?? "-"})`);
              }
            } catch (parseErr) {
              console.warn(`[bridge] ⚠ AI yanıtı parse edilemedi: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
            }
          } else {
            console.log(`[bridge]   SSE client yok — adım broadcast edilmiyor`);
          }
        } else if (statusCode >= 400) {
          // Log errors from LLM API
          const errText = responseBody.toString("utf-8").slice(0, 300);
          console.error(`\n[bridge] ⚠ LLM proxy error: HTTP ${statusCode} | model=${parsedModel} | ${durationMs}ms\n  ${errText}`);
          writeBridgeLog({
            type: "error",
            ts: new Date().toISOString(),
            runId: currentRunId,
            caseId: currentCaseId,
            provider: providerLabel,
            model: parsedModel,
            endpoint: targetUrl.pathname,
            responseStatus: statusCode,
            requestSizeBytes: bodyBytes.length,
            responseSizeBytes: responseBody.length,
            durationMs,
            error: errText,
          });
        }

        if (!res.headersSent) {
          res.writeHead(statusCode, {
            "Content-Type": proxyRes.headers["content-type"] ?? "application/json",
            "Content-Length": responseBody.length,
            "Access-Control-Allow-Origin": "*",
          });
          res.end(responseBody);
        }
      });
    });

    proxyReq.on("error", (err: Error) => {
      const durationMs = Date.now() - proxyCallStart;
      console.error(`\n[bridge] ✗ LLM proxy request error: ${err.message}`);
      writeBridgeLog({
        type: "error",
        ts: new Date().toISOString(),
        runId: currentRunId,
        caseId: currentCaseId,
        provider: providerLabel,
        endpoint: targetPath,
        durationMs,
        error: err.message,
      });
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: err.message, code: "BRIDGE_PROXY_ERROR" } }));
      }
    });

    proxyReq.write(bodyBytes);
    proxyReq.end();
  });
}

// ── AWS Bedrock proxy ─────────────────────────────────────────────────────────
// Chrome extension OpenAI formatında gönderir; bu endpoint Bedrock'a çevirir.
// Claude modelleri için Bedrock Messages API kullanılır.
function handleBedrockProxy(req: http.IncomingMessage, res: http.ServerResponse) {
  const proxyCallStart = Date.now();
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", () => {
    void (async () => {
      let messages: { role: string; content: string | Array<{ type: string; text: string }> }[] = [];
      let systemPrompt = "";
      let modelId = BEDROCK_MODEL_ID;
      let maxTokens = 8192;

      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (Array.isArray(parsed.messages)) {
          const raw = parsed.messages as { role: string; content: unknown }[];
          // Extract system message separately (Bedrock Messages API requirement)
          const systemMsg = raw.find((m) => m.role === "system");
          if (systemMsg) systemPrompt = String(systemMsg.content ?? "");
          messages = raw.filter((m) => m.role !== "system").map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          }));
        }
        if (typeof parsed.model === "string" && parsed.model) modelId = parsed.model;
        if (typeof parsed.max_tokens === "number") maxTokens = parsed.max_tokens;
      } catch { /* use defaults */ }

      // Handle tool_choice and tools forwarding
      let tools: unknown[] | undefined;
      let toolChoice: unknown;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (Array.isArray(parsed.tools)) tools = parsed.tools as unknown[];
        if (parsed.tool_choice) toolChoice = parsed.tool_choice;
      } catch { /* ignore */ }

      // Build Bedrock Anthropic Messages API request
      const bedrockBody: Record<string, unknown> = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        messages,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(tools ? { tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      };

      const bedrockBodyStr = JSON.stringify(bedrockBody);

      console.log(
        `[bridge] 🤖 Bedrock isteği | model=${modelId}` +
        ` boyut=${Buffer.byteLength(bedrockBodyStr)}B step=${stepCounter} run=${currentRunId}`
      );

      try {
        const client = getBedrockClient();
        const command = new InvokeModelWithResponseStreamCommand({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body: Buffer.from(bedrockBodyStr),
        });

        const streamRes = await client.send(command);

        // ── Stream chunk'larını topla ve Anthropic Messages formatına birleştir ──
        // Bedrock SSE chunk tipleri: message_start, content_block_start,
        // content_block_delta, content_block_stop, message_delta, message_stop
        interface ContentBlock {
          type: "text" | "tool_use";
          text?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        }
        let stopReason = "end_turn";
        let inputTokens = 0;
        let outputTokens = 0;
        const contentBlocks: ContentBlock[] = [];
        let currentBlockIdx = -1;
        const blockTypes: string[] = [];
        const toolInputAccum: string[] = [];
        const textAccum: string[] = [];

        if (streamRes.body) {
          for await (const event of streamRes.body) {
            if (event.chunk?.bytes) {
              try {
                const chunkText = Buffer.from(event.chunk.bytes).toString("utf-8");
                const chunkJson = JSON.parse(chunkText) as Record<string, unknown>;
                const chunkType = String(chunkJson.type ?? "");

                if (chunkType === "message_start") {
                  const msg = chunkJson.message as Record<string, unknown> | undefined;
                  const u = msg?.usage as Record<string, number> | undefined;
                  if (u) inputTokens = u.input_tokens ?? 0;
                }
                else if (chunkType === "content_block_start") {
                  currentBlockIdx++;
                  const block = chunkJson.content_block as Record<string, unknown> | undefined;
                  const blockType = String(block?.type ?? "text");
                  blockTypes[currentBlockIdx] = blockType;
                  textAccum[currentBlockIdx] = "";
                  toolInputAccum[currentBlockIdx] = "";
                  if (blockType === "tool_use") {
                    contentBlocks[currentBlockIdx] = {
                      type: "tool_use",
                      id: String(block?.id ?? `tool_${currentBlockIdx}`),
                      name: String(block?.name ?? ""),
                      input: {},
                    };
                  } else {
                    contentBlocks[currentBlockIdx] = { type: "text", text: "" };
                  }
                }
                else if (chunkType === "content_block_delta") {
                  const delta = chunkJson.delta as Record<string, unknown> | undefined;
                  const deltaType = String(delta?.type ?? "");
                  const idx = typeof chunkJson.index === "number" ? chunkJson.index : currentBlockIdx;
                  if (deltaType === "text_delta") {
                    const t = String(delta?.text ?? "");
                    textAccum[idx] = (textAccum[idx] ?? "") + t;
                    if (contentBlocks[idx]) (contentBlocks[idx] as { text: string }).text = textAccum[idx];
                  } else if (deltaType === "input_json_delta") {
                    const partial = String(delta?.partial_json ?? "");
                    toolInputAccum[idx] = (toolInputAccum[idx] ?? "") + partial;
                  }
                }
                else if (chunkType === "content_block_stop") {
                  const idx = typeof chunkJson.index === "number" ? chunkJson.index : currentBlockIdx;
                  if (blockTypes[idx] === "tool_use" && toolInputAccum[idx]) {
                    try {
                      (contentBlocks[idx] as { input: unknown }).input = JSON.parse(toolInputAccum[idx]);
                    } catch { /* keep empty */ }
                  }
                }
                else if (chunkType === "message_delta") {
                  const delta = chunkJson.delta as Record<string, unknown> | undefined;
                  if (delta?.stop_reason) stopReason = String(delta.stop_reason);
                  const u = chunkJson.usage as Record<string, number> | undefined;
                  if (u) outputTokens = u.output_tokens ?? 0;
                }
              } catch { /* malformed chunk — skip */ }
            }
          }
        }

        const durationMs = Date.now() - proxyCallStart;

        // Reassemble as complete Anthropic Messages API response
        const responseJson: Record<string, unknown> = {
          id: `bedrock-${Date.now()}`,
          type: "message",
          role: "assistant",
          content: contentBlocks.filter(Boolean),
          model: modelId,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        };

        console.log(
          `[bridge] ✅ Bedrock SSE tamamlandı | model=${modelId} ${durationMs}ms` +
          ` giriş=${inputTokens} çıkış=${outputTokens} blok=${contentBlocks.filter(Boolean).length}`
        );

        // Broadcast SSE step to QA UI
        if (sseClients.length > 0) {
          const step = extractStep(responseJson, stepCounter++);
          if (step) {
            broadcastStep(step);
            const goal = (step.reflection as Record<string, string> | undefined)?.next_goal ?? "";
            const actionName = (step.action as Record<string, string> | undefined)?.name ?? "";
            if (goal || actionName) {
              console.log(`[bridge] 📍 Adım ${step.stepIndex}: ${actionName ? `[${actionName}] ` : ""}${goal.slice(0, 80)}`);
            }
          }
        }

        writeBridgeLog({
          type: "llm_proxy",
          ts: new Date().toISOString(),
          runId: currentRunId,
          caseId: currentCaseId,
          provider: "bedrock",
          model: modelId,
          durationMs,
          tokenUsage: { prompt: inputTokens, completion: outputTokens, total: inputTokens + outputTokens },
        });

        const responseBytes = Buffer.from(JSON.stringify(responseJson));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": responseBytes.length,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(responseBytes);
      } catch (err) {
        const durationMs = Date.now() - proxyCallStart;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bridge] ✗ Bedrock SSE hata: ${msg} | ${durationMs}ms`);
        writeBridgeLog({
          type: "error",
          ts: new Date().toISOString(),
          runId: currentRunId,
          caseId: currentCaseId,
          provider: "bedrock",
          model: modelId,
          durationMs,
          error: msg,
        });
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ error: { message: msg, code: "BEDROCK_PROXY_ERROR" } }));
        }
      }
    })();
  });
}

function fixOllamaCloud(parsed: Record<string, unknown>) {
  if (parsed.tool_choice === "required") {
    parsed.tool_choice = "auto";
  }
  if (parsed.tool_choice && typeof parsed.tool_choice === "object") {
    const tc = parsed.tool_choice as Record<string, unknown>;
    if (tc.type === "any") parsed.tool_choice = "auto";
  }
  delete parsed.thinking;
  delete parsed.extended_thinking;
}

// ── HTTP server ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Bedrock proxy
  if (req.url?.startsWith("/bedrock-proxy/")) {
    handleBedrockProxy(req, res);
    return;
  }

  // Anthropic proxy
  if (req.url?.startsWith("/anthropic-proxy/")) {
    // Anthropic Bearer Authorization değil x-api-key header'ı bekler;
    // anahtarı extraHeaders üzerinden enjekte etmezsek upstream 401 döner.
    const anthropicHeaders: Record<string, string> = {
      "anthropic-version": "2023-06-01",
    };
    if (ANTHROPIC_API_KEY) anthropicHeaders["x-api-key"] = ANTHROPIC_API_KEY;
    handleProxy(req, res, ANTHROPIC_API_BASE, ANTHROPIC_API_KEY, "/anthropic-proxy", anthropicHeaders, (parsed) => {
      if (parsed.tool_choice && typeof parsed.tool_choice === "object") {
        const tc = parsed.tool_choice as Record<string, unknown>;
        if (tc.type === "any") {
          parsed.tool_choice = "required";
        } else if (tc.type === "tool" && tc.name) {
          parsed.tool_choice = { type: "function", function: { name: tc.name } };
        }
      }
      delete parsed.thinking;
    });
    return;
  }

  // OpenAI proxy
  if (req.url?.startsWith("/openai-proxy/")) {
    handleProxy(req, res, OPENAI_API_BASE, OPENAI_API_KEY, "/openai-proxy");
    return;
  }

  // Ollama proxy (yerel HTTP sunucu — OpenAI-compatible /v1/* endpoint'leri)
  if (req.url?.startsWith("/ollama-proxy/")) {
    const isOllamaCloud = _llmProvider === "ollama" && OLLAMA_API_BASE.includes("ollama.com");
    handleProxy(req, res, OLLAMA_API_BASE, OLLAMA_API_KEY, "/ollama-proxy",
      undefined,
      isOllamaCloud ? fixOllamaCloud : undefined
    );
    return;
  }

  // Ollama native /api/chat ↔ OpenAI format köprüsü
  // Chrome extension OpenAI formatı gönderir; bu endpoint Ollama native API'ye dönüştürür
  // Extension baseURL'e /v1/chat/completions ekleyerek gönderebilir — startsWith ile yakala
  if (req.url?.startsWith("/ollama-chat-compat") && req.method === "POST") {
    handleOllamaChat(req, res);
    return;
  }

  // GET /events — SSE
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(": connected\n\n");
    sseClients.push(res);
    const clientCount = sseClients.length;
    console.log(`[bridge] 📡 SSE client bağlandı (aktif: ${clientCount}) | run=${currentRunId}`);
    req.on("close", () => {
      sseClients = sseClients.filter((c) => c !== res);
      console.log(`[bridge] 📡 SSE client ayrıldı (kalan: ${sseClients.length}) | run=${currentRunId}`);
    });
    return;
  }

  // GET /status
  if (req.method === "GET" && req.url === "/status") {
    const connected = hubConnected();
    const busy = pendingTask !== null;
    console.log(`[bridge] 🔍 /status sorgulandı → connected=${connected} busy=${busy}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ connected, busy }));
    return;
  }

  // POST /navigate — extension'daki aktif sekmeyi belirtilen URL'e yönlendir
  if (req.method === "POST" && req.url === "/navigate") {
    if (!hubConnected()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Extension bağlı değil." }));
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      let payload: { url: string };
      try { payload = JSON.parse(body); } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Geçersiz JSON" }));
        return;
      }
      if (!payload.url) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "url alanı gerekli" }));
        return;
      }
      console.log(`[bridge] 🌐 Navigasyon: ${payload.url}`);
      hubWs!.send(JSON.stringify({ type: "navigate", url: payload.url }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // POST /execute
  if (req.method === "POST" && req.url === "/execute") {
    if (!hubConnected()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Extension bağlı değil. Chrome'da http://localhost:${PORT} açın.` }));
      return;
    }
    if (pendingTask) {
      // Stale task temizle — önceki run çöktü ama pendingTask kalmış
      console.warn(`[bridge] ⚠ Stale pendingTask bulundu (run=${currentRunId}), temizleniyor...`);
      const stale = pendingTask;
      pendingTask = null;
      currentRunId = "unknown";
      currentCaseId = "unknown";
      stale.resolve({ success: false, data: "Stale görev temizlendi — yeni görev başlatılıyor" });
    }

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      void (async () => {
      let payload: { task: string; config: Record<string, unknown>; startUrl?: string; runId?: string; caseId?: string };
      try { payload = JSON.parse(body); } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Geçersiz JSON" }));
        return;
      }

      const { task, config, startUrl, runId, caseId } = payload;
      if (!task) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "task alanı gerekli" }));
        return;
      }

      // Update run context for logging
      currentRunId = runId ?? "unknown";
      currentCaseId = caseId ?? "unknown";

      // Route LLM calls through bridge proxy
      const patchedConfig = { ...config };
      stepCounter = 0;
      if (String(patchedConfig.baseURL ?? "").includes("bedrock-proxy")) {
        console.log("[bridge] → /bedrock-proxy üzerinden yönlendiriliyor (Bedrock'a zaten işaret ediyor)");
      } else if (String(patchedConfig.baseURL ?? "").startsWith("bedrock://")) {
        patchedConfig.baseURL = `http://localhost:${PORT}/bedrock-proxy/v1`;
        console.log("[bridge] → /bedrock-proxy/v1 üzerinden yönlendiriliyor");
      } else if (String(patchedConfig.baseURL ?? "").includes("api.anthropic.com")) {
        patchedConfig.baseURL = `http://localhost:${PORT}/anthropic-proxy/v1`;
        console.log("[bridge] → /anthropic-proxy/v1 üzerinden yönlendiriliyor");
      } else if (String(patchedConfig.baseURL ?? "").includes("api.openai.com")) {
        patchedConfig.baseURL = `http://localhost:${PORT}/openai-proxy/v1`;
        console.log("[bridge] → /openai-proxy/v1 üzerinden yönlendiriliyor");
      } else {
        console.log(`[bridge] → Özel baseURL kullanılıyor: ${patchedConfig.baseURL ?? "(yok)"}`);
      }

      console.log(
        `\n[bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `[bridge] ▶ YENİ GÖREV\n` +
        `[bridge]   run=${currentRunId} case=${currentCaseId}\n` +
        `[bridge]   model=${patchedConfig.model ?? "?"}\n` +
        `[bridge]   startUrl=${startUrl ?? "(yok)"}\n` +
        `[bridge]   maxSteps=${patchedConfig.maxSteps ?? "?"}\n` +
        `[bridge]   task (ilk 120): ${task.slice(0, 120)}…\n` +
        `[bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );

      // Flush 200 headers immediately — prevents Node.js undici headersTimeout (300s default)
      // from firing on long-running tasks. Body is sent when the task completes.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();

      pendingTask = {
        resolve: (result) => {
          pendingTask = null;
          currentRunId = "unknown";
          currentCaseId = "unknown";
          res.end(JSON.stringify(result));
        },
        reject: (err: Error) => {
          pendingTask = null;
          currentRunId = "unknown";
          currentCaseId = "unknown";
          res.end(JSON.stringify({ success: false, error: err.message, data: err.message }));
        },
        runId: runId,
      };

      // Config priming: extension'ın useAgent[config] useEffect'i her execute config'i için
      // agent.dispose() çağırıp race condition'a sebep oluyor. İlk execute'ta config gönderip
      // chrome.storage.local'a yazdırıyoruz; sonraki gerçek execute config'siz gidiyor.
      const currentSignature = JSON.stringify({
        baseURL: patchedConfig.baseURL,
        model: patchedConfig.model,
        apiKey: typeof patchedConfig.apiKey === "string" ? patchedConfig.apiKey.slice(-8) : "",
      });

      if (primedConfigSignature !== currentSignature) {
        console.log(`[bridge] 🔧 Config priming — extension chrome.storage'ına yazılıyor (model=${patchedConfig.model})`);
        const primingMsg = { type: "execute", task: "ping", config: patchedConfig };
        pendingPrimerResponses++;
        hubWs!.send(JSON.stringify(primingMsg));
        // Priming execute race ile "Task aborted" döndürür; sonucu sessizce yutup devam et.
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          warmupResolver = () => { clearTimeout(timer); resolve(); };
          timer = setTimeout(() => {
            if (warmupResolver) {
              console.warn(`[bridge] ⚠ Priming timeout (5s) — devam ediliyor`);
              warmupResolver = null;
              resolve();
            }
          }, 5000);
        });
        // React useEffect cleanup'ın tamamlanması için ek bekleme
        await new Promise((r) => setTimeout(r, 600));
        primedConfigSignature = currentSignature;
        console.log(`[bridge] ✓ Config primed`);
      }

      writeBridgeLog({
        type: "execute",
        ts: new Date().toISOString(),
        runId: currentRunId,
        caseId: currentCaseId,
        model: String(patchedConfig.model ?? "unknown"),
        message: `Görev başlatıldı: ${task.slice(0, 120)}...`,
      });

      // Gerçek execute — config field'ı YOK (useEffect re-render tetiklemez)
      const msg: Record<string, unknown> = { type: "execute", task };

      console.log(`[bridge] 📨 Extension'a "execute" mesajı gönderiliyor (config-less)...`);
      hubWs!.send(JSON.stringify(msg));
      console.log(`[bridge] ✅ Mesaj gönderildi — AI adım akışı bekleniyor...`);
      })();
    });
    return;
  }

  // POST /command — extension'a özel komut gönder (take_screenshot vb.)
  if (req.method === "POST" && req.url === "/command") {
    if (!hubConnected()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Extension bağlı değil." }));
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(body); } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Geçersiz JSON" }));
        return;
      }
      hubWs!.send(JSON.stringify(payload));
      console.log(`[bridge] 📨 /command → extension: type=${payload.type}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // POST /stop  — force=true ile stale pendingTask'ı da temizler
  if (req.method === "POST" && req.url?.startsWith("/stop")) {
    if (hubConnected()) hubWs!.send(JSON.stringify({ type: "stop" }));
    if (pendingTask) {
      const t = pendingTask;
      pendingTask = null;
      currentRunId = "unknown";
      currentCaseId = "unknown";
      t.resolve({ success: false, data: "Kullanıcı tarafından durduruldu" });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /launcher → launcher.html
  if (req.method === "GET" && req.url === "/launcher") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(launcherHtml);
    return;
  }

  // GET /logs/:runId — serve structured JSONL log for a run
  if (req.method === "GET" && req.url?.startsWith("/logs/")) {
    const runId = req.url.slice("/logs/".length).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!runId) {
      res.writeHead(400); res.end("Missing runId");
      return;
    }
    const logFile = path.join(LOG_DIR, `${runId}.jsonl`);
    if (!fs.existsSync(logFile)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Log dosyası bulunamadı: ${runId}.jsonl` }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(fs.readFileSync(logFile, "utf-8"));
    return;
  }

  // GET / → launcher
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(launcherHtml);
    return;
  }

  res.writeHead(404); res.end();
});

// ── WebSocket server ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  if (hubWs && hubWs.readyState === WebSocket.OPEN) {
    ws.close(4000, "Another hub already connected");
    return;
  }
  hubWs = ws;
  console.log("[bridge] Extension hub bağlandı ✓");
  writeBridgeLog({
    type: "connection",
    ts: new Date().toISOString(),
    runId: "bridge",
    message: "Chrome Extension hub bağlandı",
  });
  notifyUI({ connected: true, busy: pendingTask !== null });

  ws.on("message", (rawData: Buffer) => {
    let msg: { type: string; success?: boolean; data?: string; message?: string; step?: unknown };
    try { msg = JSON.parse(rawData.toString("utf-8")); } catch { return; }

    // Priming warmup: ilk config'li execute'un sonucunu sessizce yut.
    // Safety timeout sonrası gelen geç response'lar da yutulmalı (pendingPrimerResponses sayacı).
    if ((msg.type === "result" || msg.type === "error") && pendingPrimerResponses > 0) {
      pendingPrimerResponses--;
      console.log(`[bridge] 🔧 Priming sonucu yutuldu (${msg.type}) — gerçek execute hazırlanıyor`);
      if (warmupResolver) {
        const resolve = warmupResolver;
        warmupResolver = null;
        resolve();
      }
      return;
    }

    if (msg.type === "result") {
      const success = msg.success ?? false;
      const data = msg.data ?? "";
      console.log(
        `\n[bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `[bridge] ${success ? "✅ GÖREV BAŞARILI" : "❌ GÖREV BAŞARISIZ"}\n` +
        `[bridge]   run=${currentRunId} case=${currentCaseId}\n` +
        `[bridge]   toplam adım=${stepCounter}\n` +
        (data ? `[bridge]   sonuç: ${data.slice(0, 200)}\n` : "") +
        `[bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );

      writeBridgeLog({
        type: "execute",
        ts: new Date().toISOString(),
        runId: currentRunId,
        caseId: currentCaseId,
        message: `Görev sonucu: success=${success} — ${data.slice(0, 150)}`,
      });

      pendingTask?.resolve({ success, data });
    } else if (msg.type === "error") {
      const errMsg = msg.message ?? "Extension'dan bilinmeyen hata";
      console.error(
        `\n[bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `[bridge] 💥 GÖREV HATASI\n` +
        `[bridge]   run=${currentRunId} case=${currentCaseId}\n` +
        `[bridge]   hata: ${errMsg}\n` +
        `[bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );

      writeBridgeLog({
        type: "error",
        ts: new Date().toISOString(),
        runId: currentRunId,
        caseId: currentCaseId,
        error: errMsg,
      });

      pendingTask?.reject(new Error(errMsg));
    } else if (msg.type === "step") {
      // Extension'dan gelen anlık adım — SSE clients'a ilet
      if (msg.step) {
        const stepData = msg.step as Record<string, unknown>;
        const step = extractStep(stepData, stepCounter++);
        if (step) {
          broadcastStep(step);
          const goal = (step.reflection as Record<string, string> | undefined)?.next_goal ?? "";
          const action = (step.action as Record<string, string> | undefined)?.name ?? "";
          if (goal || action) {
            console.log(`[bridge] 📍 WS Adım ${step.stepIndex}: ${action ? `[${action}] ` : ""}${goal.slice(0, 80)}`);
          }
        } else {
          console.log(`[bridge]   WS step alındı fakat adım çıkarılamadı`);
        }
      }
    } else if (msg.type === "take_screenshot") {
      // Bridge'den extension'a screenshot komutu gönder
      const ssMsg = msg as {
        type: string;
        testCaseId?: string;
        stepIndex?: number;
        label?: string;
      };
      if (hubConnected()) {
        hubWs!.send(JSON.stringify({
          type: "take_screenshot",
          testCaseId: ssMsg.testCaseId,
          stepIndex: ssMsg.stepIndex,
          label: ssMsg.label || "step",
        }));
        console.log(`[bridge] 📸 Screenshot komutu extension'a gönderildi: ${ssMsg.testCaseId} step=${ssMsg.stepIndex}`);
      }
    } else if (msg.type === "screenshot_result") {
      // Extension'dan gelen screenshot — Next.js API'ye ilet
      const sMsg = msg as {
        type: string;
        testCaseId?: string;
        stepIndex?: number;
        imageBase64?: string;
        timestamp?: string;
        label?: string;
      };
      console.log(`[bridge] 📸 Screenshot alındı: ${sMsg.testCaseId} step=${sMsg.stepIndex}`);

      const appPort = process.env.PORT ?? "3000";
      fetch(`http://localhost:${appPort}/api/screenshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testCaseId: sMsg.testCaseId,
          stepIndex: sMsg.stepIndex,
          imageBase64: sMsg.imageBase64,
          timestamp: sMsg.timestamp ?? new Date().toISOString(),
          label: sMsg.label,
        }),
      }).catch((err: Error) => {
        console.warn(`[bridge] Screenshot API iletme hatası: ${err.message}`);
      });
    } else {
      console.log(`[bridge] ❓ Bilinmeyen WS mesaj tipi: ${msg.type}`);
    }
  });

  ws.on("close", () => {
    console.log(`\n[bridge] ⚠ Extension hub bağlantısı kesildi | aktif görev=${pendingTask !== null}`);
    if (hubWs === ws) hubWs = null;
    // Extension reconnect olduğunda agentRef yeni baştan kurulacak → priming tekrar gerekli
    primedConfigSignature = null;
    pendingPrimerResponses = 0;
    if (warmupResolver) { warmupResolver(); warmupResolver = null; }
    writeBridgeLog({
      type: "connection",
      ts: new Date().toISOString(),
      runId: "bridge",
      message: "Chrome Extension hub bağlantısı kesildi",
    });
    notifyUI({ connected: false, busy: false });
    if (pendingTask) {
      const t = pendingTask;
      pendingTask = null;
      currentRunId = "unknown";
      currentCaseId = "unknown";
      console.error(
        `[bridge] ❌ Hub disconnect — aktif görev iptal ediliyor\n` +
        `  run=${t.runId ?? "unknown"}\n` +
        `  Olası nedenler: Chrome sekmesi kapandı, extension crashed, ağ koptu`
      );
      t.reject(new Error(
        "Görev çalışırken Chrome Extension bağlantısı kesildi.\n" +
        "Olası nedenler:\n" +
        "  1. Chrome sekmesi kapatıldı veya extension devre dışı kaldı\n" +
        "  2. Ağ bağlantısı kesildi\n" +
        "Çözüm: Chrome'da http://localhost:" + PORT + " adresini açarak extension'ı yeniden bağlayın."
      ));
    }
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[bridge] Port ${PORT} kullanımda. Başka bir bridge çalışıyor mu?`);
  } else {
    console.error("[bridge] Sunucu hatası:", err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[bridge] ✓ HTTP + WS  →  http://localhost:${PORT}`);
  console.log(`[bridge]   Anthropic proxy: /anthropic-proxy/*`);
  console.log(`[bridge]   OpenAI proxy:    /openai-proxy/*`);
  console.log(`[bridge]   Extension bağlamak için Chrome'da http://localhost:${PORT} açın`);

  const openCmd = platform() === "darwin" ? "open" : platform() === "win32" ? 'start ""' : "xdg-open";
  exec(`${openCmd} "http://localhost:${PORT}"`, (err) => {
    if (err) console.warn(`[bridge] Launcher otomatik açılamadı. Manuel: http://localhost:${PORT}`);
  });
});

// Keep-alive heartbeat
let _heartbeatTick = 0;
setInterval(() => {
  if (hubWs?.readyState === WebSocket.OPEN) hubWs.ping();
  _heartbeatTick++;
  const state = hubConnected() ? "\x1b[32mbağlı\x1b[0m" : "\x1b[33mbağlı değil\x1b[0m";
  const busyStr = pendingTask !== null ? `\x1b[33mmeşgul (run=${currentRunId} adım=${stepCounter})\x1b[0m` : "boşta";
  // Her 10 vuruşta bir (30s) tam durum satırı yaz
  if (_heartbeatTick % 10 === 0) {
    console.log(`[bridge] 💓 Extension: ${state}  durum: ${busyStr}  sseClients: ${sseClients.length}`);
  } else {
    process.stdout.write(`\r[bridge] 💓 Extension: ${state}  durum: ${busyStr}   `);
  }
}, 3000);

process.on("SIGINT", () => { console.log("\n[bridge] Kapatılıyor..."); process.exit(0); });
