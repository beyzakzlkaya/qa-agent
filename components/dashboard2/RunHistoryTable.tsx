"use client";

import { useState, forwardRef } from "react";
import { Run, mockErrorMap } from "@/lib/mockData";
import {
  ExternalLink,
  Play,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

type StatusFilter = "Tümü" | "Başarısız" | "Çalışıyor" | "Geçti";
type TypeFilter = "Tümü" | "Regresyon" | "Özel";

interface Props {
  runs: Run[];
  /** IDs from NextStepsPanel filter click */
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

function ExpandedRow({ run }: { run: Run }) {
  const isTimeout =
    run.name.toLowerCase().includes("kupon") || run.duration.includes("m");
  const err = isTimeout ? mockErrorMap.timeout : mockErrorMap.default;

  return (
    <tr>
      <td colSpan={9} className="bg-background border-t border-border">
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-foreground mb-0.5">
                {run.name}
              </p>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30">
                        {err.errorType}
                      </span>
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
          <div className="bg-muted/40 dark:bg-black/60 rounded-md p-3 font-mono space-y-1">
            {err.stackTrace.map((line, i) => (
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
