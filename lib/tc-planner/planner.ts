/**
 * lib/tc-planner/planner.ts
 *
 * Creates a prioritized test plan based on risk analysis, historical results,
 * and coverage gaps.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index";
import { loadAllCases } from "../test-engine/parser";
import type { TestCase, Platform } from "../types";
import type { TestPlanOptions, TestPlan, PrioritizedTestCase } from "./types";

const AVG_TEST_DURATION_MINUTES = 3;

// ── SQLite table init ──────────────────────────────────────────────────────────

export function ensureTestPlansTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_plans (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── Historical pass rate helpers ───────────────────────────────────────────────

interface CaseStatRow {
  case_id: string;
  last_status: string;
  last_run: string;
  total_runs: number;
  failures: number;
}

function getRecentCaseStats(days = 30): Map<string, CaseStatRow> {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT
        case_id,
        status as last_status,
        executed_at as last_run,
        COUNT(*) as total_runs,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures
      FROM case_results
      WHERE executed_at >= ?
      GROUP BY case_id`
    )
    .all(cutoff) as CaseStatRow[];

  const map = new Map<string, CaseStatRow>();
  for (const row of rows) {
    map.set(row.case_id, row);
  }
  return map;
}

function wasRecentlyFailed(
  caseId: string,
  stats: Map<string, CaseStatRow>,
  days = 7
): boolean {
  const row = stats.get(caseId);
  if (!row) return false;

  const lastRun = new Date(row.last_run);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return lastRun > cutoff && row.last_status === "failed";
}

function wasNeverRun(caseId: string, stats: Map<string, CaseStatRow>): boolean {
  return !stats.has(caseId);
}

// ── Prioritization engine ──────────────────────────────────────────────────────

function prioritizeCases(
  cases: TestCase[],
  options: TestPlanOptions,
  stats: Map<string, CaseStatRow>
): PrioritizedTestCase[] {
  const ra = options.riskAnalysis;
  const suggestedIds = new Set(ra?.suggestedTestCaseIds ?? []);
  const affectedScreens = new Set(
    (ra?.affectedScreens ?? []).map((s) => s.toLowerCase())
  );
  const riskScore = ra?.riskScore ?? 50;

  const scored: { tc: TestCase; score: number; reason: string }[] = [];

  for (const tc of cases) {
    let score = 0;
    const reasons: string[] = [];

    // Rule 1: suggested by risk analysis
    if (suggestedIds.has(tc.id)) {
      score += 100;
      reasons.push("Risk analizi tarafından önerildi");
    }

    // Rule 2: affected screen match
    const tcPlatforms = tc.platform.map((p) => p.toLowerCase());
    const screenMatch = tcPlatforms.some((p) => affectedScreens.has(p));
    if (screenMatch) {
      score += 60;
      reasons.push("Etkilenen ekranla eşleşiyor");
    }

    // Rule 3: never been run
    if (wasNeverRun(tc.id, stats)) {
      score += 40;
      reasons.push("Hiç koşulmamış");
    }

    // Rule 4: recently failed
    if (wasRecentlyFailed(tc.id, stats)) {
      score += 80;
      reasons.push("Son 7 günde başarısız oldu");
    }

    // Rule 5: priority weight
    const priorityWeight: Record<string, number> = {
      critical: 30,
      high: 20,
      medium: 10,
      low: 0,
    };
    score += priorityWeight[tc.priority] ?? 0;

    // Apply target screen filter
    if (options.targetScreens && options.targetScreens.length > 0) {
      const overlap = tc.platform.some((p) =>
        options.targetScreens!.includes(p as Platform)
      );
      if (!overlap) continue;
    }

    scored.push({
      tc,
      score,
      reason: reasons.length > 0 ? reasons.join("; ") : "Normal öncelik",
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const maxTC = options.maxTestCases ?? 20;
  return scored.slice(0, maxTC).map((item, idx) => ({
    testCaseId: item.tc.id,
    priority: idx + 1,
    reason: item.reason,
    riskScore,
    targetScreen: item.tc.platform[0] ?? "backoffice",
  }));
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function createTestPlan(
  options: TestPlanOptions
): Promise<TestPlan> {
  ensureTestPlansTable();

  const allCases = loadAllCases();
  const stats = getRecentCaseStats(30);

  let filteredCases = allCases;
  if (!options.includeRegression === false) {
    // When includeRegression is explicitly false, skip regression-only cases
    filteredCases = allCases.filter(
      (c) => !c.tags.every((t) => t === "regression")
    );
  }

  const prioritized = prioritizeCases(filteredCases, options, stats);

  const source: TestPlan["source"] = options.riskAnalysis
    ? "pr"
    : options.manualPrompt
    ? "manual"
    : "jira";

  const coverageAreas = Array.from(
    new Set(prioritized.map((p) => p.targetScreen))
  );

  const plan: TestPlan = {
    id: uuidv4(),
    source,
    priority: prioritized,
    estimatedDurationMinutes:
      prioritized.length * AVG_TEST_DURATION_MINUTES,
    coverageAreas,
    newScenariosToGenerate:
      options.riskAnalysis?.suggestedNewTestScenarios ?? [],
    createdAt: new Date().toISOString(),
  };

  // Persist to SQLite
  const db = getDb();
  db.prepare(
    "INSERT INTO test_plans (id, source, plan_json) VALUES (?, ?, ?)"
  ).run(plan.id, plan.source, JSON.stringify(plan));

  console.log(
    `[tc-planner] Plan oluşturuldu: ${plan.id} | ${prioritized.length} TC | source: ${source}`
  );

  return plan;
}

export function getTestPlan(planId: string): TestPlan | null {
  ensureTestPlansTable();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM test_plans WHERE id = ?")
    .get(planId) as { plan_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.plan_json) as TestPlan;
  } catch {
    return null;
  }
}
