"use client";

import { useState, useEffect, forwardRef } from "react";
import { Run } from "@/lib/mockData";
import type { CaseResult } from "@/lib/types";
import {
  ExternalLink,
  Play,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
} from "lucide-react";

type StatusFilter = "Tümü" | "Başarısız" | "Çalışıyor" | "Geçti";
type TypeFilter = "Tümü" | "Regresyon" | "Özel";

interface Props {
  runs: Run[];
  /** IDs from AttentionPanel / module heatmap drill-down */
  activeFilterIds?: string[];
  /** Label shown in the active filter chip */
  activeFilterLabel?: string;
  /** Clears the external filter */
  onClearFilter?: () => void;
}

function StatusBadge({ status }: { status: Run["status"] }) {
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-destructive/10 text-destructive border border-destructive/30">
        Başarısız
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
        Çalışıyor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-success/10 text-success border border-success/30">
      Geçti
    </span>
  );
}

function deriveErrorType(message: string): string {
  const m = message.trim();
  const colonIdx = m.indexOf(":");
  if (colonIdx > 0 && colonIdx < 60) {
    const head = m.slice(0, colonIdx);
    if (/^[A-Z][A-Za-z0-9_]*Error$/.test(head)) return head;
  }
  if (/timeout/i.test(m)) return "TimeoutError";
  if (/assert/i.test(m)) return "AssertionError";
  return "Error";
}

function ExpandedRow({ run }: { run: Run }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/runs/${run.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { caseResults: CaseResult[] };
        if (!cancelled) setCases(data.caseResults ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Yüklenemedi");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  const failedCases = cases.filter((c) => c.status === "failed" && c.errorMessage);

  return (
    <tr>
      <td colSpan={9} className="bg-background border-t border-border">
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-foreground mb-0.5">
                {run.name}
              </p>
              {run.status === "failed" && failedCases.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30">
                  {deriveErrorType(failedCases[0].errorMessage!)}
                </span>
              )}
              {run.status === "passed" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                  Geçti
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors">
                <ExternalLink className="w-3 h-3" />
                JIRA&apos;da Aç
              </button>
              <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Play className="w-3 h-3" />
                Tekrar Çalıştır
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Detaylar yükleniyor...
            </div>
          )}

          {error && !loading && (
            <div className="text-xs text-destructive">
              Detaylar yüklenemedi: {error}
            </div>
          )}

          {!loading && !error && cases.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Bu koşum için kayıtlı test case sonucu yok.
            </div>
          )}

          {!loading && !error && failedCases.length > 0 && (
            <div className="space-y-2">
              {failedCases.map((c) => (
                <div
                  key={c.id}
                  className="bg-muted/40 dark:bg-black/60 rounded-md p-3 font-mono space-y-1"
                >
                  <p className="text-[11px] text-muted-foreground/80">
                    {c.caseId} · {c.platform}
                  </p>
                  {c.errorMessage!.split("\n").map((line, i) => (
                    <p
                      key={i}
                      className={`text-[11px] ${
                        i === 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!loading && !error && run.status !== "failed" && cases.length > 0 && (
            <div className="space-y-3">
              {cases.map((c) => (
                <div key={c.id} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-foreground">
                      {c.caseId}{" "}
                      <span className="text-muted-foreground font-normal">
                        · {c.platform}
                      </span>
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {c.status}
                    </span>
                  </div>
                  {c.steps.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Adım kaydedilmemiş.
                    </p>
                  ) : (
                    <ol className="space-y-1">
                      {c.steps.map((s) => (
                        <li
                          key={s.index}
                          className="flex items-start gap-2 text-[11px]"
                        >
                          {s.status === "success" ? (
                            <CheckCircle2 className="w-3 h-3 mt-0.5 text-success shrink-0" />
                          ) : s.status === "failed" ? (
                            <XCircle className="w-3 h-3 mt-0.5 text-destructive shrink-0" />
                          ) : (
                            <span className="w-3 h-3 mt-0.5 rounded-full border border-muted-foreground/40 shrink-0" />
                          )}
                          <span className="text-muted-foreground">
                            <span className="text-foreground">{s.index}.</span>{" "}
                            {s.description}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

const PAGE_SIZE = 12;

export const RunHistoryTable = forwardRef<HTMLDivElement, Props>(
function RunHistoryTable({ runs, activeFilterIds, activeFilterLabel, onClearFilter }, ref) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Tümü");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("Tümü");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const highlightedSet = new Set(activeFilterIds ?? []);
  const isExternalFiltered = (activeFilterIds?.length ?? 0) > 0;

  const baseFiltered = runs.filter((r) => {
    const statusMatch =
      statusFilter === "Tümü" ||
      (statusFilter === "Başarısız" && r.status === "failed") ||
      (statusFilter === "Çalışıyor" && r.status === "running") ||
      (statusFilter === "Geçti" && r.status === "passed");
    const typeMatch = typeFilter === "Tümü" || r.type === typeFilter;
    return statusMatch && typeMatch;
  });

  // When an external filter is active, only show those run IDs
  const filtered = isExternalFiltered
    ? baseFiltered.filter((r) => highlightedSet.has(r.id))
    : baseFiltered;

  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = paginated.length < filtered.length;

  const toggle = (id: string) => setExpanded((prev) => (prev === id ? null : id));

  const statusFilters: StatusFilter[] = ["Tümü", "Başarısız", "Çalışıyor", "Geçti"];
  const typeFilters: TypeFilter[] = ["Tümü", "Regresyon", "Özel"];

  return (
    <div ref={ref} className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header + Filters */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground">Run Geçmişi</h3>
          <span className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
            {filtered.length} / {runs.length}
          </span>
          {isExternalFiltered && activeFilterLabel && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30">
              {activeFilterLabel} filtresi aktif
              <button
                onClick={onClearFilter}
                className="ml-0.5 hover:opacity-70 transition-opacity"
                title="Filtreyi kaldır"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status filter */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
            {statusFilters.map((f) => (
              <button
                key={f}
                onClick={() => { setStatusFilter(f); setPage(1); }}
                className={`text-[11px] px-2.5 py-1 rounded transition-all font-medium ${
                  statusFilter === f
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {/* Type filter */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
            {typeFilters.map((f) => (
              <button
                key={f}
                onClick={() => { setTypeFilter(f); setPage(1); }}
                className={`text-[11px] px-2.5 py-1 rounded transition-all font-medium ${
                  typeFilter === f
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-6" />
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Durum</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">İsim</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ortam</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tür</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sonuç</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Süre</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tarih</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((run) => (
              <>
                <tr
                  key={run.id}
                  className={`border-b border-border hover:bg-accent hover:bg-accent cursor-pointer transition-colors ${
                    isExternalFiltered && highlightedSet.has(run.id)
                      ? "border-l-2 border-l-warning"
                      : ""
                  }`}
                  onClick={() => toggle(run.id)}
                >
                  <td className="px-3 py-3 text-muted-foreground/70">
                    {expanded === run.id ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <span className="text-xs text-foreground truncate block" title={run.name}>
                      {run.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {run.env}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{run.type}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[11px]">
                        <span className="text-success font-medium">{run.passed} geçti</span>
                      {" / "}
                      <span className="text-destructive font-medium">{run.failed} kaldı</span>
                      {" / "}
                      <span className="text-muted-foreground">{run.total} top.</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground">{run.duration}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-muted-foreground">{run.date}</span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Dışarıda aç"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                        title="Tekrar çalıştır"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === run.id && <ExpandedRow key={`exp-${run.id}`} run={run} />}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/70">
            {paginated.length} / {filtered.length} gösteriliyor
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
          >
            Daha fazla yükle
          </button>
        </div>
      )}
    </div>
  );
});

RunHistoryTable.displayName = "RunHistoryTable";
