"use client";

import { useState, useRef, useEffect } from "react";
import type { Run } from "@/lib/mockData";
import type { TestRun } from "@/lib/types";
import { KpiCards } from "@/components/dashboard2/KpiCards";
import { FailureDistribution, RecurringFailures } from "@/components/dashboard2/FailureCards";
import { HourlyChart, DurationAnalysis } from "@/components/dashboard2/ChartSection";
import { RunHistoryTable } from "@/components/dashboard2/RunHistoryTable";
import { NextStepsPanel } from "@/components/dashboard2/NextSteps";
import { TrendCharts } from "@/components/dashboard2/TrendCharts";
import { GitBranch, RefreshCw, Loader2 } from "lucide-react";
import Link from "next/link";

// ─── DB TestRun → Dashboard Run adapter ───────────────────────────────────────

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(2);
    const hour = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${day}.${month}.${year} ${hour}:${min}`;
  } catch {
    return iso;
  }
}

function dbRunToDashboardRun(r: TestRun, durationMs?: number): Run {
  const statusMap: Record<string, Run["status"]> = {
    success: "passed",
    failed: "failed",
    partial: "failed",
    running: "running",
  };

  const typeMap: Record<string, Run["type"]> = {
    smoke: "Regresyon",
    regression: "Regresyon",
    monkey: "Regresyon",
    custom: "Özel",
  };

  return {
    id: r.id,
    name: r.name,
    status: statusMap[r.status] ?? "failed",
    env: r.environment === "preprod" ? "Preprod" : "Prod",
    type: typeMap[r.runType] ?? "Özel",
    passed: r.passedCases,
    failed: r.failedCases,
    total: r.totalCases,
    duration: formatDuration(durationMs),
    date: formatDate(r.startedAt),
  };
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

interface RunsApiResponse {
  runs: (TestRun & { durationMs?: number })[];
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilterIds, setActiveFilterIds] = useState<string[]>([]);
  const [activeFilterLabel, setActiveFilterLabel] = useState<string>("");
  const tableRef = useRef<HTMLDivElement>(null);

  const fetchRuns = async () => {
    try {
      setError(null);
      const res = await fetch("/api/runs?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RunsApiResponse;
      const adapted = (data.runs ?? []).map((r) => dbRunToDashboardRun(r, r.durationMs));
      setRuns(adapted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [refreshKey]);

  const handleRefresh = () => {
    setRefreshing(true);
    setLoading(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 800);
  };

  const handleFilter = (ids: string[], label: string) => {
    setActiveFilterIds(ids);
    setActiveFilterLabel(label);
  };

  const handleClearFilter = () => {
    setActiveFilterIds([]);
    setActiveFilterLabel("");
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Test çalıştırma geçmişi, hata analizi ve öneriler
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/jira"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <GitBranch className="w-3.5 h-3.5" />
            JIRA Pipeline
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md border border-border text-muted-foreground bg-card hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Veriler yüklenirken hata oluştu: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Çalıştırma verileri yükleniyor...</span>
        </div>
      )}

      {/* Dashboard content — shown when we have data (even empty) */}
      {!loading && (
        <>
          {/* Empty state */}
          {runs.length === 0 && !error && (
            <div className="rounded-md border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Henüz test çalıştırması yok.{" "}
                <Link href="/prompt" className="text-primary hover:underline">
                  Bir test başlatın
                </Link>{" "}
                veya{" "}
                <Link href="/jira" className="text-primary hover:underline">
                  JIRA Pipeline&apos;ı deneyin
                </Link>
                .
              </p>
            </div>
          )}

          {runs.length > 0 && (
            <>
              {/* Section 1: KPI Cards */}
              <KpiCards runs={runs} />

              {/* Section 2: Two-column — Failure distribution + Recurring failures */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FailureDistribution runs={runs} />
                <RecurringFailures runs={runs} />
              </div>

              {/* Section 3: Three-column — Hourly chart + Duration analysis */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <HourlyChart />
                </div>
                <div className="lg:col-span-1">
                  <DurationAnalysis runs={runs} />
                </div>
              </div>

              {/* Section 4: Run History Table */}
              <RunHistoryTable
                runs={runs}
                ref={tableRef}
                activeFilterIds={activeFilterIds}
                activeFilterLabel={activeFilterLabel}
                onClearFilter={handleClearFilter}
              />

              {/* Section 5: Trend Charts (live DB data) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TrendCharts />
              </div>

              {/* Section 6: Next Steps */}
              <NextStepsPanel runs={runs} tableRef={tableRef} onFilter={handleFilter} />
            </>
          )}
        </>
      )}
    </div>
  );
}
