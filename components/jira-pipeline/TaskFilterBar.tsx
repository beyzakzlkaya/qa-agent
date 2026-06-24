"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export type TaskFilterId = "all" | "highPriority" | "reopen" | "stuck" | "deferred";
export type TaskSortId = "sla" | "newest" | "priority" | "complexity";

interface FilterOption {
  id: TaskFilterId;
  label: string;
  count?: number;
}

interface Props {
  activeFilter: TaskFilterId;
  onFilterChange: (id: TaskFilterId) => void;
  filterCounts: Partial<Record<TaskFilterId, number>>;
  sortId: TaskSortId;
  onSortChange: (id: TaskSortId) => void;
  hasDeferredItems: boolean;
  qaUsers: string[];
  selectedQa: string | null;
  onQaChange: (qa: string | null) => void;
}

const FILTER_OPTIONS: FilterOption[] = [
  { id: "all", label: "Tümü" },
  { id: "highPriority", label: "Yüksek öncelik" },
  { id: "reopen", label: "Reopen" },
  { id: "stuck", label: "SLA riski" },
];

const SORT_OPTIONS: { id: TaskSortId; label: string }[] = [
  { id: "sla", label: "SLA yaklaşan" },
  { id: "newest", label: "En yeni" },
  { id: "priority", label: "Öncelik" },
  { id: "complexity", label: "Karmaşıklık" },
];

export function TaskFilterBar({
  activeFilter,
  onFilterChange,
  filterCounts,
  sortId,
  onSortChange,
  hasDeferredItems,
  qaUsers,
  selectedQa,
  onQaChange,
}: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative">
          <select
            value={selectedQa ?? ""}
            onChange={(e) => onQaChange(e.target.value === "" ? null : e.target.value)}
            className={cn(
              "appearance-none pl-2.5 pr-7 py-1 rounded-full border text-[11px] font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring transition-all",
              selectedQa
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
            )}
            title={selectedQa ? `${selectedQa} üzerindeki işler` : "QA seç"}
          >
            <option value="">QA: Tümü</option>
            {qaUsers.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <ChevronDown
            className={cn(
              "w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none",
              selectedQa ? "text-primary-foreground" : "text-muted-foreground"
            )}
          />
        </div>
        {FILTER_OPTIONS.map((opt) => {
          const count = filterCounts[opt.id];
          const active = activeFilter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onFilterChange(opt.id)}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              )}
            >
              <span>{opt.label}</span>
              {typeof count === "number" && (
                <span
                  className={cn(
                    "text-[10px] px-1 rounded",
                    active ? "bg-primary-foreground/20" : "bg-muted/40 text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {hasDeferredItems && (
          <button
            type="button"
            onClick={() => onFilterChange("deferred")}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all",
              activeFilter === "deferred"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
            )}
          >
            <span>Sonraya bıraktıklarım</span>
            {typeof filterCounts.deferred === "number" && (
              <span
                className={cn(
                  "text-[10px] px-1 rounded",
                  activeFilter === "deferred" ? "bg-primary-foreground/20" : "bg-muted/40 text-muted-foreground"
                )}
              >
                {filterCounts.deferred}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Sırala:</span>
        <div className="relative">
          <select
            value={sortId}
            onChange={(e) => onSortChange(e.target.value as TaskSortId)}
            className="appearance-none pl-2.5 pr-7 py-1 rounded border border-border bg-card text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
