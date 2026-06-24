import { getRun, getCaseResultsByRun, getScreenshotsByRun } from "../db/queries";
import type { CaseResult, TestRun } from "../types";
import {
  bucketsFromCounts,
  classifyErrorMessage,
  emptyErrorTypeCounts,
  type ErrorTypeBucket,
} from "./error-types";

export interface RunSummaryFailure {
  caseResultId: string;
  caseId: string;
  platform: CaseResult["platform"];
  errorMessage: string | null;
  lastStep: string | null;
  errorType: ReturnType<typeof classifyErrorMessage>;
  anomalies: { type: string; message: string; screenshot?: string }[];
  screenshots: string[];
}

export interface RunSummary {
  run: TestRun;
  counts: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    running: number;
  };
  durationMs: number | null;
  errorTypes: ErrorTypeBucket[];
  topFailures: RunSummaryFailure[];
  links: {
    runUrl: string;
    reportUrl: string;
  };
}

export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

const MAX_TOP_FAILURES = 10;

export function buildRunSummary(runId: string): RunSummary | null {
  const run = getRun(runId);
  if (!run) return null;

  const caseResults = getCaseResultsByRun(runId);
  const screenshotsByCase = new Map<string, string[]>();
  for (const s of getScreenshotsByRun(runId)) {
    const list = screenshotsByCase.get(s.test_case_id) ?? [];
    list.push(s.file_path);
    screenshotsByCase.set(s.test_case_id, list);
  }

  const counts = {
    total: caseResults.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    running: 0,
  };
  const errorCounts = emptyErrorTypeCounts();
  const failures: RunSummaryFailure[] = [];

  for (const r of caseResults) {
    if (r.status === "success") counts.passed++;
    else if (r.status === "failed") counts.failed++;
    else if (r.status === "skipped") counts.skipped++;
    else if (r.status === "running") counts.running++;

    if (r.status === "failed") {
      errorCounts[classifyErrorMessage(r.errorMessage)]++;

      const lastStep =
        r.steps && r.steps.length > 0
          ? r.steps[r.steps.length - 1].description
          : null;

      const screenshots = screenshotsByCase.get(r.caseId) ?? [];

      failures.push({
        caseResultId: r.id,
        caseId: r.caseId,
        platform: r.platform,
        errorMessage: r.errorMessage ?? null,
        lastStep,
        errorType: classifyErrorMessage(r.errorMessage),
        anomalies: r.anomalies.map((a) => ({
          type: a.type,
          message: a.message,
          screenshot: a.screenshot,
        })),
        screenshots,
      });
    }
  }

  const durationMs = run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  const appBaseUrl = getAppBaseUrl();

  return {
    run,
    counts,
    durationMs,
    errorTypes: bucketsFromCounts(errorCounts),
    topFailures: failures.slice(0, MAX_TOP_FAILURES),
    links: {
      runUrl: `${appBaseUrl}/run/${runId}`,
      reportUrl: `${appBaseUrl}/reports/${runId}`,
    },
  };
}
