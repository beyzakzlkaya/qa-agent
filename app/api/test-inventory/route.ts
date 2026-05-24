import { NextResponse } from "next/server";
import { loadAllCases } from "@/lib/test-engine/parser";
import { getDb } from "@/lib/db";

export interface StaleTest {
  caseId: string;
  lastRun: string | null;
  daysAgo: number | null;
  title?: string;
  domain?: string;
}

export interface TestInventory {
  totalCases: number;
  activeCases: number;
  ranLast7Days: number;
  stale14d: StaleTest[];
  domainsWithoutTests: string[];
  domainsWithTests: string[];
}

const ALL_DOMAINS = [
  "identity",
  "order",
  "inventory",
  "trade-in",
  "buyback",
  "warranty",
  "refurbishment",
  "financials",
  "general",
];

export async function GET() {
  try {
    const cases = loadAllCases();
    const total = cases.length;

    const db = getDb();
    const recentRuns = db
      .prepare(
        `SELECT case_id, MAX(executed_at) as lastRun
         FROM case_results
         GROUP BY case_id`
      )
      .all() as { case_id: string; lastRun: string }[];

    const ranLast7 = db
      .prepare(
        `SELECT COUNT(DISTINCT case_id) as c
         FROM case_results
         WHERE executed_at > datetime('now', '-7 days')`
      )
      .get() as { c: number };

    const runMap = new Map<string, string>();
    for (const r of recentRuns) runMap.set(r.case_id, r.lastRun);

    const now = Date.now();
    const stale14d: StaleTest[] = [];
    for (const c of cases) {
      const lastRun = runMap.get(c.id) ?? null;
      let daysAgo: number | null = null;
      if (lastRun) {
        const ms = Date.parse(lastRun);
        if (Number.isFinite(ms)) {
          daysAgo = Math.floor((now - ms) / (1000 * 60 * 60 * 24));
        }
      }
      // either never ran (null) OR ran more than 14 days ago
      if (lastRun === null || (daysAgo !== null && daysAgo >= 14)) {
        stale14d.push({
          caseId: c.id,
          lastRun,
          daysAgo,
          title: c.title,
          domain: c.domain,
        });
      }
    }
    stale14d.sort((a, b) => (b.daysAgo ?? 99999) - (a.daysAgo ?? 99999));

    const domainsWithTests = Array.from(new Set(cases.map((c) => c.domain).filter(Boolean) as string[]));
    const domainsWithoutTests = ALL_DOMAINS.filter((d) => !domainsWithTests.includes(d));

    const payload: TestInventory = {
      totalCases: total,
      activeCases: total, // all loaded cases are considered active for now
      ranLast7Days: ranLast7.c ?? 0,
      stale14d: stale14d.slice(0, 20),
      domainsWithoutTests,
      domainsWithTests,
    };

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
