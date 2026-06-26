import { getDb } from "./index";
import type {
  TestRun,
  CaseResult,
  SavedPrompt,
  RunStatus,
  CaseStatus,
} from "../types";

// ─── Runs ────────────────────────────────────────────────────────────────────

export function createRun(run: Omit<TestRun, "passedCases" | "failedCases">): TestRun {
  const db = getDb();
  db.prepare(`
    INSERT INTO runs (id, name, environment, run_type, status, total_cases, passed_cases, failed_cases, started_at, finished_at, triggered_by)
    VALUES (@id, @name, @environment, @runType, @status, @totalCases, 0, 0, @startedAt, @finishedAt, @triggeredBy)
  `).run({
    id: run.id,
    name: run.name,
    environment: run.environment,
    runType: run.runType,
    status: run.status,
    totalCases: run.totalCases,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    triggeredBy: run.triggeredBy,
  });
  return getRun(run.id)!;
}

export function getRun(id: string): TestRun | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function listRuns(limit = 50, offset = 0): TestRun[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function updateRunStatus(
  id: string,
  status: RunStatus,
  passed: number,
  failed: number,
  finishedAt?: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE runs SET status = ?, passed_cases = ?, failed_cases = ?, finished_at = ?
    WHERE id = ?
  `).run(status, passed, failed, finishedAt ?? null, id);
}

// Server boot sırasında çağrılır. Önceki process'ten kalan "running" satırları
// (zombi runlar) failed olarak işaretler — runner artık onları takip etmiyor.
// finished_at olarak started_at kullanılır: gerçek bitiş zamanı bilinmediği
// için 0 süre göstermek, NOW koyup haftalar-aylar süren run gibi göstermekten
// daha dürüst.
export function markStaleRunsAsFailed(): number {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE runs
       SET status = 'failed',
           finished_at = COALESCE(finished_at, started_at)
       WHERE status = 'running'`
    )
    .run();
  return result.changes;
}

function rowToRun(row: Record<string, unknown>): TestRun {
  return {
    id: row.id as string,
    name: row.name as string,
    environment: row.environment as TestRun["environment"],
    runType: row.run_type as TestRun["runType"],
    status: row.status as RunStatus,
    totalCases: row.total_cases as number,
    passedCases: row.passed_cases as number,
    failedCases: row.failed_cases as number,
    startedAt: row.started_at as string,
    finishedAt: row.finished_at as string | undefined,
    triggeredBy: row.triggered_by as TestRun["triggeredBy"],
  };
}

// ─── Case Results ────────────────────────────────────────────────────────────

export function createCaseResult(result: CaseResult): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO case_results (id, run_id, case_id, platform, status, steps, anomalies, error_message, duration_ms, executed_at)
    VALUES (@id, @runId, @caseId, @platform, @status, @steps, @anomalies, @errorMessage, @durationMs, @executedAt)
  `).run({
    id: result.id,
    runId: result.runId,
    caseId: result.caseId,
    platform: result.platform,
    status: result.status,
    steps: JSON.stringify(result.steps),
    anomalies: JSON.stringify(result.anomalies),
    errorMessage: result.errorMessage ?? null,
    durationMs: result.durationMs ?? null,
    executedAt: result.executedAt,
  });
}

/**
 * Bulk-insert all finished case results in a single transaction.
 * Called once at run_end — the client tracks live state via WS during the run.
 */
export function saveCaseResults(results: CaseResult[]): void {
  if (results.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO case_results
      (id, run_id, case_id, platform, status, steps, anomalies, error_message, duration_ms, executed_at)
    VALUES
      (@id, @runId, @caseId, @platform, @status, @steps, @anomalies, @errorMessage, @durationMs, @executedAt)
  `);
  const insertMany = db.transaction((rows: CaseResult[]) => {
    for (const r of rows) {
      stmt.run({
        id: r.id,
        runId: r.runId,
        caseId: r.caseId,
        platform: r.platform,
        status: r.status,
        steps: JSON.stringify(r.steps),
        anomalies: JSON.stringify(r.anomalies),
        errorMessage: r.errorMessage ?? null,
        durationMs: r.durationMs ?? null,
        executedAt: r.executedAt,
      });
    }
  });
  insertMany(results);
}

export function updateCaseResult(
  id: string,
  status: CaseStatus,
  steps: CaseResult["steps"],
  anomalies: CaseResult["anomalies"],
  errorMessage?: string,
  durationMs?: number
): void {
  const db = getDb();
  db.prepare(`
    UPDATE case_results SET status = ?, steps = ?, anomalies = ?, error_message = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    status,
    JSON.stringify(steps),
    JSON.stringify(anomalies),
    errorMessage ?? null,
    durationMs ?? null,
    id
  );
}

export function getCaseResultsByRun(runId: string): CaseResult[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM case_results WHERE run_id = ? ORDER BY executed_at ASC").all(runId) as Record<string, unknown>[];
  return rows.map(rowToCaseResult);
}

function rowToCaseResult(row: Record<string, unknown>): CaseResult {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    caseId: row.case_id as string,
    platform: row.platform as CaseResult["platform"],
    status: row.status as CaseStatus,
    steps: JSON.parse(row.steps as string),
    anomalies: JSON.parse(row.anomalies as string),
    errorMessage: row.error_message as string | undefined,
    durationMs: row.duration_ms as number | undefined,
    executedAt: row.executed_at as string,
  };
}

// ─── Saved Prompts ───────────────────────────────────────────────────────────

export function createSavedPrompt(prompt: Omit<SavedPrompt, "runCount">): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO saved_prompts (id, title, prompt, platform, tags, created_at, last_run_at, run_count)
    VALUES (@id, @title, @prompt, @platform, @tags, @createdAt, @lastRunAt, 0)
  `).run({
    id: prompt.id,
    title: prompt.title,
    prompt: prompt.prompt,
    platform: prompt.platform,
    tags: JSON.stringify(prompt.tags),
    createdAt: prompt.createdAt,
    lastRunAt: prompt.lastRunAt ?? null,
  });
}

export function listSavedPrompts(): SavedPrompt[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM saved_prompts ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    prompt: row.prompt as string,
    platform: row.platform as SavedPrompt["platform"],
    tags: JSON.parse(row.tags as string),
    createdAt: row.created_at as string,
    lastRunAt: row.last_run_at as string | undefined,
    runCount: row.run_count as number,
  }));
}

export function incrementPromptRunCount(id: string): void {
  const db = getDb();
  db.prepare("UPDATE saved_prompts SET run_count = run_count + 1, last_run_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
}

export function deleteSavedPrompt(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM saved_prompts WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Risk Analyses ────────────────────────────────────────────────────────────

export interface RiskAnalysisRow {
  id: number;
  pr_number: number | null;
  jira_issue_key: string | null;
  risk_level: string;
  risk_score: number;
  analysis_json: string;
  created_at: string;
}

export function saveRiskAnalysis(
  analysisJson: string,
  prNumber?: number,
  jiraIssueKey?: string,
  riskLevel?: string,
  riskScore?: number
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO risk_analyses (pr_number, jira_issue_key, risk_level, risk_score, analysis_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    prNumber ?? null,
    jiraIssueKey ?? null,
    riskLevel ?? null,
    riskScore ?? null,
    analysisJson
  );
  return result.lastInsertRowid as number;
}

export function getRiskAnalysis(prNumber: number): RiskAnalysisRow | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM risk_analyses WHERE pr_number = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(prNumber) as RiskAnalysisRow | undefined;
  return row ?? null;
}

// ─── Screenshots ──────────────────────────────────────────────────────────────

export interface ScreenshotRow {
  id: number;
  run_id: string | null;
  test_case_id: string;
  step_index: number | null;
  file_path: string;
  label: string | null;
  taken_at: string;
}

export function saveScreenshot(
  testCaseId: string,
  filePath: string,
  stepIndex?: number,
  label?: string,
  runId?: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO screenshots (run_id, test_case_id, step_index, file_path, label)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId ?? null, testCaseId, stepIndex ?? null, filePath, label ?? null);
}

export function getScreenshots(testCaseId: string): ScreenshotRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM screenshots WHERE test_case_id = ? ORDER BY taken_at ASC"
    )
    .all(testCaseId) as ScreenshotRow[];
}

export function getScreenshotsByRun(runId: string): ScreenshotRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM screenshots WHERE run_id = ? ORDER BY taken_at ASC"
    )
    .all(runId) as ScreenshotRow[];
}

// ─── JIRA risk summary cache ──────────────────────────────────────────────────

export interface JiraRiskSummaryRow {
  jira_key: string;
  pr_number: number | null;
  summary: string;
  input_hash: string;
  created_at: string;
}

export function getCachedRiskSummary(
  jiraKey: string,
  inputHash: string
): JiraRiskSummaryRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM jira_risk_summaries WHERE jira_key = ? AND input_hash = ?`
    )
    .get(jiraKey, inputHash) as JiraRiskSummaryRow | undefined;
  return row ?? null;
}

export function saveRiskSummary(
  jiraKey: string,
  inputHash: string,
  summary: string,
  prNumber?: number | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO jira_risk_summaries
       (jira_key, pr_number, summary, input_hash, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(jiraKey, prNumber ?? null, summary, inputHash);
}

// ─── JIRA task iteration tracking ─────────────────────────────────────────────

export interface JiraTaskIterationRow {
  run_id: string;
  jira_key: string;
  iteration_index: number;
  reopen_after: number;
  reopen_reason: string | null;
  created_at: string;
}

export function recordJiraIteration(
  runId: string,
  jiraKey: string
): JiraTaskIterationRow {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM jira_task_iterations WHERE jira_key = ?`
    )
    .get(jiraKey) as { cnt: number };
  const iterationIndex = (existing?.cnt ?? 0) + 1;
  db.prepare(
    `INSERT OR REPLACE INTO jira_task_iterations
       (run_id, jira_key, iteration_index, reopen_after, reopen_reason)
     VALUES (?, ?, ?, 0, NULL)`
  ).run(runId, jiraKey, iterationIndex);
  return {
    run_id: runId,
    jira_key: jiraKey,
    iteration_index: iterationIndex,
    reopen_after: 0,
    reopen_reason: null,
    created_at: new Date().toISOString(),
  };
}

export function getJiraIterations(jiraKey: string): JiraTaskIterationRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM jira_task_iterations WHERE jira_key = ? ORDER BY iteration_index ASC`
    )
    .all(jiraKey) as JiraTaskIterationRow[];
}

// ─── JIRA QA effort estimate cache ────────────────────────────────────────────

export interface JiraQaEffortRow {
  jira_key: string;
  input_hash: string;
  payload_json: string;
  case_count: number;
  total_minutes: number;
  created_at: string;
}

export function getCachedQaEffort(
  jiraKey: string,
  inputHash: string
): JiraQaEffortRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM jira_qa_effort WHERE jira_key = ? AND input_hash = ?`)
    .get(jiraKey, inputHash) as JiraQaEffortRow | undefined;
  return row ?? null;
}

export function saveQaEffort(
  jiraKey: string,
  inputHash: string,
  payloadJson: string,
  caseCount: number,
  totalMinutes: number
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO jira_qa_effort
       (jira_key, input_hash, payload_json, case_count, total_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(jiraKey, inputHash, payloadJson, caseCount, totalMinutes);
}

// ─── Trend Analytics ──────────────────────────────────────────────────────────

export interface DailyTrendRow {
  date: string;
  passRate: number;
  totalRuns: number;
}

export interface TestCaseHealthRow {
  test_case_id: string;
  totalRuns: number;
  passRate: number;
  failCount: number;
}

export function getDailyTrend(days = 14): DailyTrendRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      date(executed_at) as date,
      ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1) as passRate,
      COUNT(*) as totalRuns
    FROM case_results
    WHERE executed_at > datetime('now', '-${days} days')
    GROUP BY date(executed_at)
    ORDER BY date ASC
  `).all() as DailyTrendRow[];
}

export interface RunsSummary {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  partialRuns: number;
  runningRuns: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  caseSuccessRate: number;
  runSuccessRate: number;
}

/**
 * Aggregates across **all** runs in the DB — not a recent window.
 * Case-level success rate is the source of truth: it weights large test
 * suites correctly and treats `partial` runs fairly (their passed cases
 * still count). The run-level rate is kept for the legacy KPI display.
 */
export function getRunsSummary(): RunsSummary {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as totalRuns,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as passedRuns,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedRuns,
        SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partialRuns,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as runningRuns,
        COALESCE(SUM(total_cases), 0) as totalCases,
        COALESCE(SUM(passed_cases), 0) as passedCases,
        COALESCE(SUM(failed_cases), 0) as failedCases
       FROM runs`
    )
    .get() as Record<string, number>;

  const totalRuns = row.totalRuns ?? 0;
  const finishedRuns = (row.passedRuns ?? 0) + (row.failedRuns ?? 0) + (row.partialRuns ?? 0);
  const totalCases = row.totalCases ?? 0;
  const passedCases = row.passedCases ?? 0;

  return {
    totalRuns,
    passedRuns: row.passedRuns ?? 0,
    failedRuns: row.failedRuns ?? 0,
    partialRuns: row.partialRuns ?? 0,
    runningRuns: row.runningRuns ?? 0,
    totalCases,
    passedCases,
    failedCases: row.failedCases ?? 0,
    caseSuccessRate: totalCases > 0 ? Math.round((passedCases / totalCases) * 1000) / 10 : 0,
    runSuccessRate:
      finishedRuns > 0 ? Math.round(((row.passedRuns ?? 0) / finishedRuns) * 1000) / 10 : 0,
  };
}

/**
 * For each test (grouped by normalized run name) returns the most recent
 * `window` outcomes so the caller can detect flakiness server-side.
 */
export interface RecentRunOutcome {
  name: string;
  status: RunStatus;
  passedCases: number;
  failedCases: number;
  totalCases: number;
  startedAt: string;
}

export function getRecentRunOutcomes(perTestLimit = 10): RecentRunOutcome[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, status, passed_cases, failed_cases, total_cases, started_at
       FROM runs
       WHERE status IN ('success', 'failed', 'partial')
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(perTestLimit * 200) as Record<string, unknown>[];
  return rows.map((r) => ({
    name: r.name as string,
    status: r.status as RunStatus,
    passedCases: r.passed_cases as number,
    failedCases: r.failed_cases as number,
    totalCases: r.total_cases as number,
    startedAt: r.started_at as string,
  }));
}

export function getTestCaseHealth(): TestCaseHealthRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      case_id as test_case_id,
      COUNT(*) as totalRuns,
      ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1) as passRate,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failCount
    FROM case_results
    WHERE executed_at > datetime('now', '-30 days')
    GROUP BY case_id
    HAVING totalRuns >= 2
    ORDER BY passRate ASC
    LIMIT 20
  `).all() as TestCaseHealthRow[];
}
