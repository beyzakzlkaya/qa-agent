import type { Run } from "./mockData";

/**
 * Strip "(Tekrar)" / retry suffix so reruns of the same test cluster together.
 */
function normalizeRunName(name: string): string {
  return name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
}

export function groupRunsByName(runs: Run[]): Map<string, Run[]> {
  const map = new Map<string, Run[]>();
  for (const r of runs) {
    const key = normalizeRunName(r.name);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

/**
 * A run "counts as passed" for flaky detection if its overall status is
 * `passed`, OR it has at least one passed case (covers `partial` runs).
 * A run "counts as failed" if status is `failed` or `partial`.
 *
 * Why: a `partial` status means the run had both successes and failures, which
 * is itself evidence of flakiness — treat it as both.
 */
function runRepresentsPass(r: Run): boolean {
  return r.status === "passed" || r.passed > 0;
}
function runRepresentsFail(r: Run): boolean {
  return r.status === "failed" || r.status === "partial";
}

export interface FlakyTest {
  name: string;
  recentRuns: Run[];
  passedCount: number;
  failedCount: number;
}

/**
 * A test is flaky when, across its most recent N runs, both pass and fail
 * outcomes appear AND we have at least `minRuns` data points.
 */
export function detectFlakyTests(
  runs: Run[],
  options: { window?: number; minRuns?: number } = {}
): FlakyTest[] {
  const window = options.window ?? 5;
  const minRuns = options.minRuns ?? 3;
  const grouped = groupRunsByName(runs);
  const flaky: FlakyTest[] = [];
  for (const [name, group] of grouped) {
    const recent = group.slice(0, window);
    if (recent.length < minRuns) continue;
    const passed = recent.filter(runRepresentsPass).length;
    const failed = recent.filter(runRepresentsFail).length;
    if (passed > 0 && failed > 0) {
      flaky.push({ name, recentRuns: recent, passedCount: passed, failedCount: failed });
    }
  }
  return flaky;
}

export function countFlakyTests(runs: Run[]): number {
  return detectFlakyTests(runs).length;
}
