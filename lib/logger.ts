/**
 * lib/logger.ts
 *
 * Structured JSON logger for the QA agent platform.
 *
 * Writes newline-delimited JSON (JSONL) to data/logs/{runId}.jsonl.
 * Also writes to stdout in development for immediate feedback.
 *
 * Log types:
 *  - llm_request   : Full LLM request + response (API key redacted)
 *  - step          : Individual test step emitted from SSE stream
 *  - anomaly       : Detected anomaly
 *  - bridge_execute: Bridge /execute call payload + result
 *  - info / error  : General structured messages
 */

import fs from "node:fs";
import path from "node:path";
import type { TestStep, Anomaly } from "./types";

// ─── Log entry types ──────────────────────────────────────────────────────────

export interface LlmRequestLog {
  type: "llm_request";
  ts: string;
  runId: string;
  caseId: string;
  provider: string;
  model: string;
  endpoint: string;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  durationMs: number;
  error?: string;
}

export interface StepLog {
  type: "step";
  ts: string;
  runId: string;
  caseId: string;
  stepIndex: number;
  description: string;
  status: string;
  durationMs?: number;
}

export interface AnomalyLog {
  type: "anomaly";
  ts: string;
  runId: string;
  caseId: string;
  anomalyType: string;
  message: string;
}

export interface BridgeExecuteLog {
  type: "bridge_execute";
  ts: string;
  runId: string;
  caseId: string;
  task: string;
  startUrl: string;
  model: string;
  success?: boolean;
  resultSummary?: string;
  durationMs: number;
  error?: string;
}

export interface InfoLog {
  type: "info" | "error";
  ts: string;
  runId?: string;
  message: string;
  data?: unknown;
}

export type LogEntry =
  | LlmRequestLog
  | StepLog
  | AnomalyLog
  | BridgeExecuteLog
  | InfoLog;

// ─── Log directory setup ──────────────────────────────────────────────────────

const LOG_DIR = path.join(process.cwd(), "data", "logs");

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // Non-fatal: logging should never crash the app
  }
}

// ─── Core write function ──────────────────────────────────────────────────────

function writeEntry(entry: LogEntry): void {
  try {
    ensureLogDir();

    const runId = ("runId" in entry && entry.runId) ? entry.runId : "global";
    const logFile = path.join(LOG_DIR, `${runId}.jsonl`);
    const line = JSON.stringify(entry) + "\n";

    fs.appendFileSync(logFile, line, "utf-8");
  } catch {
    // Non-fatal
  }

  // Also print to stdout in dev for immediate visibility
  if (process.env.NODE_ENV !== "production") {
    const prefix =
      entry.type === "error"
        ? "\x1b[31m[ERROR]\x1b[0m"
        : entry.type === "llm_request"
        ? "\x1b[36m[LLM]\x1b[0m"
        : entry.type === "step"
        ? "\x1b[32m[STEP]\x1b[0m"
        : entry.type === "anomaly"
        ? "\x1b[33m[ANOMALY]\x1b[0m"
        : entry.type === "bridge_execute"
        ? "\x1b[35m[BRIDGE]\x1b[0m"
        : "\x1b[90m[LOG]\x1b[0m";

    const summary =
      entry.type === "llm_request"
        ? `${entry.provider}/${entry.model} → HTTP ${entry.responseStatus} (${entry.durationMs}ms)${entry.error ? " ERROR: " + entry.error : ""}`
        : entry.type === "step"
        ? `[${entry.status}] step ${entry.stepIndex}: ${entry.description.slice(0, 80)}`
        : entry.type === "anomaly"
        ? `${entry.anomalyType}: ${entry.message.slice(0, 100)}`
        : entry.type === "bridge_execute"
        ? `${entry.startUrl} success=${entry.success ?? "?"} (${entry.durationMs}ms)${entry.error ? " ERR: " + entry.error : ""}`
        : "message" in entry
        ? String(entry.message).slice(0, 120)
        : JSON.stringify(entry).slice(0, 120);

    console.log(`${prefix} ${summary}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a full LLM request + response.
 * API key is automatically redacted from requestBody.
 */
export function logLlmRequest(entry: Omit<LlmRequestLog, "type" | "ts">): void {
  // Redact API key from request body
  let safeRequest = entry.requestBody;
  try {
    if (typeof safeRequest === "object" && safeRequest !== null) {
      const r = { ...(safeRequest as Record<string, unknown>) };
      if (r.apiKey) r.apiKey = "[REDACTED]";
      if (r.api_key) r.api_key = "[REDACTED]";
      safeRequest = r;
    }
  } catch {
    // keep as-is
  }

  writeEntry({
    type: "llm_request",
    ts: new Date().toISOString(),
    ...entry,
    requestBody: safeRequest,
  });
}

/**
 * Log a test step (from SSE stream or manual step creation).
 */
export function logStep(
  runId: string,
  caseId: string,
  step: TestStep
): void {
  writeEntry({
    type: "step",
    ts: step.timestamp ?? new Date().toISOString(),
    runId,
    caseId,
    stepIndex: step.index,
    description: step.description,
    status: step.status,
    durationMs: step.durationMs,
  });
}

/**
 * Log a detected anomaly.
 */
export function logAnomaly(
  runId: string,
  caseId: string,
  anomaly: Anomaly
): void {
  writeEntry({
    type: "anomaly",
    ts: anomaly.timestamp,
    runId,
    caseId,
    anomalyType: anomaly.type,
    message: anomaly.message,
  });
}

/**
 * Log a bridge /execute call with its result.
 */
export function logBridgeExecute(
  entry: Omit<BridgeExecuteLog, "type" | "ts">
): void {
  // Truncate task for log readability
  const truncatedEntry = {
    ...entry,
    task: entry.task.slice(0, 300) + (entry.task.length > 300 ? "..." : ""),
  };

  writeEntry({
    type: "bridge_execute",
    ts: new Date().toISOString(),
    ...truncatedEntry,
  });
}

/**
 * Log a general informational message.
 */
export function logInfo(
  message: string,
  runId?: string,
  data?: unknown
): void {
  writeEntry({ type: "info", ts: new Date().toISOString(), runId, message, data });
}

/**
 * Log an error with optional context data.
 */
export function logError(
  message: string,
  runId?: string,
  data?: unknown
): void {
  writeEntry({ type: "error", ts: new Date().toISOString(), runId, message, data });
}

/**
 * Returns the path to a run's log file (for API serving / download).
 */
export function getLogFilePath(runId: string): string {
  return path.join(LOG_DIR, `${runId}.jsonl`);
}

/**
 * Reads all log entries for a run. Returns empty array if file doesn't exist.
 */
export function readRunLogs(runId: string): LogEntry[] {
  const filePath = getLogFilePath(runId);
  if (!fs.existsSync(filePath)) return [];

  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);
  } catch {
    return [];
  }
}
