"use client";

import { useEffect, useMemo, useState } from "react";
import type { Run } from "@/lib/mockData";
import { TrendingUp, TrendingDown, Minus, Repeat, Wrench, RotateCw } from "lucide-react";
import type { DailyTrendRow } from "@/lib/db/queries";

interface JiraBugStats {
  weeklyOpened: number;
  weeklyClosed: number;
  weeklyRegression: number;
  mttrHours: number | null;
  available: boolean;
}

interface TrendResp {
  dailyTrend: DailyTrendRow[];
}

interface Props {
  runs: Run[];
}

export function QualityHealthKpis({ runs }: Props) {
  const [jira, setJira] = useState<JiraBugStats | null>(null);
  const [trend, setTrend] = useState<DailyTrendRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/jira/bug-stats").then((r) => r.json()).catch(() => null),
      fetch("/api/reports/trend").then((r) => r.json()).catch(() => null),
    ]).then(([j, t]: [JiraBugStats | null, TrendResp | null]) => {
      if (cancelled) return;
      if (j) setJira(j);
      if (t) setTrend(t.dailyTrend ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Başarı oranı + 7g trend ───────────────────────────────────────────────
  const successRate = useMemo(() => {
    const total = runs.length;
    if (total === 0) return 0;
    return Math.round((runs.filter((r) => r.status === "passed").length / total) * 100);
  }, [runs]);

  const passRateDelta = useMemo(() => {
    if (trend.length < 2) return null;
    const last = trend[trend.length - 1]?.passRate ?? 0;
    const previousAvg =
      trend.slice(0, -1).reduce((a, b) => a + (b.passRate ?? 0), 0) /
      Math.max(trend.length - 1, 1);
    return Math.round((last - previousAvg) * 10) / 10;
  }, [trend]);

  // ─── Flaky test sayısı (son 5 koşumda kararsız) ────────────────────────────
  const flakyCount = useMemo(() => {
    const byName = new Map<string, Run[]>();
    for (const r of runs) {
      const key = r.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(r);
    }
    let count = 0;
    Array.from(byName.values()).forEach((group: Run[]) => {
      const last5 = group.slice(0, 5);
      const hasPassed = last5.some((r: Run) => r.status === "passed");
      const hasFailed = last5.some((r: Run) => r.status === "failed");
      if (last5.length >= 3 && hasPassed && hasFailed) count++;
    });
    return count;
  }, [runs]);

  // ─── MTTR ───────────────────────────────────────────────────────────────────
  const mttrHours = jira?.mttrHours ?? null;
  const mttrLabel = mttrHours === null
    ? "—"
    : mttrHours < 24
    ? `${mttrHours}sa`
    : `${Math.round(mttrHours / 24)}g`;

  // ─── Yeni / Regresyon oranı ────────────────────────────────────────────────
  const weeklyOpened = jira?.weeklyOpened ?? 0;
  const weeklyRegression = jira?.weeklyRegression ?? 0;
  const newCount = Math.max(weeklyOpened - weeklyRegression, 0);

  const rateColor =
    successRate < 30
      ? "text-destructive"
      : successRate < 70
      ? "text-warning"
      : "text-success";

  const rateBar =
    successRate < 30
      ? "hsl(var(--destructive))"
      : successRate < 70
      ? "hsl(var(--warning))"
      : "hsl(var(--success))";

  const trendIcon =
    passRateDelta === null || passRateDelta === 0 ? (
      <Minus className="w-3 h-3" />
    ) : passRateDelta > 0 ? (
      <TrendingUp className="w-3 h-3" />
    ) : (
      <TrendingDown className="w-3 h-3" />
    );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Başarı Oranı */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs text-muted-foreground mb-1">Başarı oranı</p>
        <p className={`text-3xl font-bold ${rateColor}`}>{successRate}%</p>
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-muted-foreground/70 mb-1">
            <span>Hedef: %80</span>
            <span
              className={`inline-flex items-center gap-0.5 ${
                passRateDelta === null
                  ? "text-muted-foreground"
                  : passRateDelta > 0
                  ? "text-success"
                  : passRateDelta < 0
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {trendIcon}
              {passRateDelta === null
                ? "—"
                : `${passRateDelta > 0 ? "+" : ""}${passRateDelta}% / 7g`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${successRate}%`, backgroundColor: rateBar }}
            />
          </div>
        </div>
      </div>

      {/* Flaky test sayısı */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Flaky testler</p>
          <Repeat className="w-3.5 h-3.5 text-warning" />
        </div>
        <p
          className={`text-3xl font-bold ${flakyCount > 0 ? "text-warning" : "text-foreground"}`}
        >
          {flakyCount}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          Son 5 koşumda hem geçti hem kaldı
        </p>
      </div>

      {/* MTTR */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">MTTR</p>
          <Wrench className="w-3.5 h-3.5 text-primary" />
        </div>
        <p className="text-3xl font-bold text-foreground">{mttrLabel}</p>
        <p className="text-[11px] text-muted-foreground mt-2">
          {jira?.available
            ? "Açılıştan kapanışa ort. süre (30g)"
            : "JIRA bağlı değil"}
        </p>
      </div>

      {/* Yeni / Regresyon */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Yeni / Regresyon</p>
          <RotateCw className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <p className="text-3xl font-bold text-foreground">
          {newCount}
          <span className="text-base font-medium text-muted-foreground"> / </span>
          <span
            className={
              weeklyRegression > 0 ? "text-destructive" : "text-muted-foreground"
            }
          >
            {weeklyRegression}
          </span>
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          {jira?.available ? "Bu hafta — yeni vs tekrar açılan" : "JIRA bağlı değil"}
        </p>
      </div>
    </div>
  );
}
