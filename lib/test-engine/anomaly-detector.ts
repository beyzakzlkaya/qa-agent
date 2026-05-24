/**
 * lib/test-engine/anomaly-detector.ts
 *
 * Detects anomalies from STRUCTURED test step data (SSE stream),
 * NOT from scanning the agent's final text blob.
 *
 * Signal sources (in priority):
 *  1. done() action with success=false in its output
 *  2. Silent element interaction failures (not interactable, not visible, no state change)
 *  3. Bridge returning success=false
 *  4. HTTP error codes found in step action outputs
 *  5. JavaScript errors found in step descriptions
 *  6. Consecutive failed steps (agent stuck in retry loop)
 */

import type { Anomaly, TestStep } from "../types";

// ─── HTTP status codes that warrant anomalies ─────────────────────────────────

const HTTP_ERROR_PATTERN = /\b(4\d{2}|5\d{2})\b/g;
const KNOWN_HTTP_ERRORS = new Set([
  400, 401, 403, 404, 405, 408, 409, 410, 422, 429, 500, 502, 503, 504,
]);

// ─── JS error patterns ────────────────────────────────────────────────────────

const JS_ERROR_PATTERNS = [
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /NetworkError/i,
  /ECONNREFUSED/i,
  /uncaught\s+error/i,
  /console\.error/i,
  /unhandledpromiserejection/i,
];

// ─── Element interaction failure patterns ─────────────────────────────────────

const ELEMENT_FAILURE_PATTERNS = [
  /silent\s+failure/i,
  /not\s+interactable/i,
  /not\s+clickable/i,
  /element\s+not\s+visible/i,
  /no\s+such\s+element/i,
  /element\s+not\s+found/i,
  /covered\s+by/i,
  /z-index/i,
  /overlay/i,
  /action\s+silently\s+failed/i,
  /state\s+did\s+not\s+change/i,
  /did\s+not\s+produce/i,
];

// ─── Core detector ────────────────────────────────────────────────────────────

/**
 * Analyses the structured SSE step stream for anomaly signals.
 * Also accepts the bridge result string for supplementary keyword scanning
 * (only on actual error signals, not vague text matching).
 */
export function detectAnomaliesFromSteps(
  steps: TestStep[],
  bridgeSuccess: boolean,
  resultData: string
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>(); // dedup by message

  function addAnomaly(a: Omit<Anomaly, "timestamp">): void {
    const key = `${a.type}:${a.message.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    anomalies.push({ ...a, timestamp: now });
  }

  // 1. Done action with explicit failure
  for (const step of steps) {
    const desc = step.description.toLowerCase();
    const hasDoneAction =
      desc.includes("✅ done") ||
      desc.includes("done →") ||
      desc.includes("done(") ||
      (desc.includes("done") && step.status === "failed");

    if (hasDoneAction && step.status === "failed") {
      addAnomaly({
        type: "outcome_mismatch",
        message: `Agent done() ile başarısız sonuç bildirdi: "${step.description.slice(0, 200)}"`,
      });
    }
  }

  // 2. Silent element interaction failures
  for (const step of steps) {
    for (const pattern of ELEMENT_FAILURE_PATTERNS) {
      if (pattern.test(step.description)) {
        addAnomaly({
          type: "unexpected",
          message: `Element etkileşim hatası: "${step.description.slice(0, 200)}" — element görünür değil, kapsanmış veya yanıt vermiyor olabilir`,
        });
        break;
      }
    }
  }

  // 3. Bridge explicit failure — only report if no done() anomaly was already added
  //    (avoids double-reporting when done(false) is the direct cause of success=false)
  if (!bridgeSuccess && anomalies.filter(a => a.type === "outcome_mismatch").length === 0) {
    const summary = resultData.slice(0, 300);
    const lowerSummary = summary.toLowerCase();

    // Distinguish between different failure modes for clearer reporting:
    //
    // (a) Agent navigated OK but never called done() at all — it ran out of steps
    //     or was blocked early. The resultData text often says "successfully navigated"
    //     with no failure language, because the agent simply stopped mid-task.
    //     This is the classic localStorage-check premature-exit pattern.
    //
    // (b) Agent said something went wrong but phrased it without "fail"/"error".
    //
    // (c) Generic bridge failure.
    const agentNeverCalledDone = steps.every(
      (s) =>
        !s.description.toLowerCase().includes("done(") &&
        !s.description.toLowerCase().includes("done →") &&
        !s.description.toLowerCase().includes("✅ done")
    );

    const isNavOnlyMessage =
      lowerSummary.includes("successfully navigated") &&
      !lowerSummary.includes("fail") &&
      !lowerSummary.includes("error") &&
      !lowerSummary.includes("not found");

    if (agentNeverCalledDone && steps.length > 0) {
      addAnomaly({
        type: "outcome_mismatch",
        message:
          `Test başarısız: Agent done() çağırmadan sonlandı (${steps.length} adım). ` +
          `Bu genellikle localStorage okuma, element bulamama veya adım limitine ulaşma nedeniyle olur. ` +
          (summary ? `Agent özeti: "${summary}"` : "Agent özeti yok."),
      });
    } else if (isNavOnlyMessage) {
      addAnomaly({
        type: "outcome_mismatch",
        message: `Test başarısız: Agent sayfaya ulaştı ancak sonraki adımlarda element etkileşimi başarısız oldu. Agent özeti: "${summary}"`,
      });
    } else {
      addAnomaly({
        type: "outcome_mismatch",
        message: `Test başarısız tamamlandı. Agent özeti: "${summary}"`,
      });
    }
  }

  // 4. HTTP error codes in step outputs
  for (const step of steps) {
    const text = step.description;
    HTTP_ERROR_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = HTTP_ERROR_PATTERN.exec(text)) !== null) {
      const code = parseInt(match[1], 10);
      if (KNOWN_HTTP_ERRORS.has(code)) {
        addAnomaly({
          type: "http_error",
          message: `HTTP ${code} hatası adımda tespit edildi: "${text.slice(0, 150)}"`,
        });
      }
    }
  }

  // 5. JavaScript / console errors in step descriptions
  for (const step of steps) {
    for (const pattern of JS_ERROR_PATTERNS) {
      if (pattern.test(step.description)) {
        addAnomaly({
          type: "console_error",
          message: `JS/Konsol hatası adımda tespit edildi: "${step.description.slice(0, 150)}"`,
        });
        break;
      }
    }
  }

  // 6. Consecutive failed or stalled steps (agent retry loop indicator)
  let consecutiveFailed = 0;
  for (const step of steps) {
    if (step.status === "failed") {
      consecutiveFailed++;
      if (consecutiveFailed >= 3) {
        addAnomaly({
          type: "unexpected",
          message: `Agent ardışık ${consecutiveFailed} başarısız adım üretti — erişilemeyen element, overlay veya sonsuz döngü olabilir`,
        });
        break;
      }
    } else {
      consecutiveFailed = 0;
    }
  }

  // 7. Bridge result text: only scan for specific HTTP codes in the data string
  //    (not vague keyword matching — that produced too many false positives)
  if (resultData) {
    HTTP_ERROR_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HTTP_ERROR_PATTERN.exec(resultData)) !== null) {
      const code = parseInt(match[1], 10);
      if (KNOWN_HTTP_ERRORS.has(code) && code >= 500) {
        // Only flag server errors from result text (4xx might be expected)
        addAnomaly({
          type: "http_error",
          message: `Sonuç metninde HTTP ${code} sunucu hatası tespit edildi`,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Legacy compatibility shim — kept so any remaining callers don't break.
 * Prefer detectAnomaliesFromSteps() in new code.
 *
 * @deprecated Use detectAnomaliesFromSteps() instead
 */
export function detectAnomalies(
  resultText: string,
  expectedOutcome: string
): Anomaly[] {
  return detectAnomaliesFromSteps([], false, resultText);
}
