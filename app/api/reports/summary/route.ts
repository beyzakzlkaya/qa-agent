import { NextResponse } from "next/server";
import { getRunsSummary, getRecentRunOutcomes, getDailyTrend } from "@/lib/db/queries";

/**
 * Aggregate dashboard KPIs computed server-side across **all** runs — not
 * the recent-100 window that `/api/runs?limit=100` returns. Trend data is
 * windowed to 14 days because that's all the daily-trend chart shows.
 */
export async function GET() {
  try {
    const summary = getRunsSummary();
    const recentOutcomes = getRecentRunOutcomes();
    const trend = getDailyTrend(14);

    // Flaky detection over the most recent runs per test name.
    const byName = new Map<string, typeof recentOutcomes>();
    for (const r of recentOutcomes) {
      const key = r.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(r);
    }
    let flakyCount = 0;
    for (const [, group] of byName) {
      const last5 = group.slice(0, 5);
      if (last5.length < 3) continue;
      const hasPass = last5.some((r) => r.status === "success" || r.passedCases > 0);
      const hasFail = last5.some((r) => r.status === "failed" || r.status === "partial");
      if (hasPass && hasFail) flakyCount++;
    }

    // 7-day delta: average passRate of last 7 days vs the 7 prior.
    let passRateDelta: number | null = null;
    if (trend.length >= 8) {
      const last7 = trend.slice(-7);
      const prev7 = trend.slice(-14, -7);
      const avg = (rows: typeof trend) =>
        rows.reduce((a, b) => a + (b.passRate ?? 0), 0) / Math.max(rows.length, 1);
      passRateDelta = Math.round((avg(last7) - avg(prev7)) * 10) / 10;
    }

    return NextResponse.json({
      summary,
      flakyCount,
      passRateDelta,
      dailyTrend: trend,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
