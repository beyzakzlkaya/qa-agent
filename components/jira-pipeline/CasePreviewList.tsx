"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestCase, PrAnalysis } from "@/lib/types";
import { extractDiffRisks } from "@/lib/jira-pipeline/diff-risks";

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    high: "bg-warning/10 text-warning border-warning/20",
    medium: "bg-warning/5 text-warning/80 border-warning/15",
    low: "bg-success/10 text-success border-success/20",
  };
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide",
        styles[priority.toLowerCase()] ?? styles.medium
      )}
    >
      {priority}
    </span>
  );
}

function CasePreviewCard({
  tc,
  selected,
  onToggle,
}: {
  tc: TestCase;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isEdge = tc.title.startsWith("[Edge]");
  const steps = tc.prompt.split("\n").filter((l) => l.trim() && !l.startsWith("Beklenen sonuç:"));

  return (
    <div
      className={cn(
        "border rounded-lg transition-all duration-150",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-card hover:border-border/80"
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          onClick={onToggle}
          className={cn(
            "mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors",
            selected ? "bg-primary border-primary" : "border-border hover:border-primary/50"
          )}
        >
          {selected && (
            <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
              <path
                d="M1.5 5l2.5 2.5 4.5-4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                isEdge
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-primary/10 text-primary border-primary/20"
              )}
            >
              {isEdge ? "Edge Case" : "Happy Path"}
            </span>
            <PriorityBadge priority={tc.priority} />
            <span className="text-[10px] text-muted-foreground font-mono">{tc.id}</span>
          </div>
          <p className="text-sm font-medium text-foreground mt-1.5 leading-snug">
            {tc.title.replace(/^\[Edge\] /, "")}
          </p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tc.expectedOutcome}</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/50 pt-2.5 space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Adımlar
          </p>
          {steps.map((step, i) => (
            <div key={i} className="flex gap-2 text-xs text-foreground/80">
              <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] mt-0.5 w-4 text-right">
                {i + 1}.
              </span>
              <span className="leading-relaxed">{step}</span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-border/40">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Beklenen Sonuç
            </p>
            <p className="text-xs text-foreground/70 leading-relaxed">{tc.expectedOutcome}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  cases: TestCase[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  prAnalysis?: PrAnalysis;
}

export function CasePreviewList({ cases, selectedIds, onToggle, onToggleAll, prAnalysis }: Props) {
  const happyPaths = cases.filter((c) => !c.title.startsWith("[Edge]"));
  const edgeCases = cases.filter((c) => c.title.startsWith("[Edge]"));
  const allSelected = selectedIds.size === cases.length;
  const risks = prAnalysis ? extractDiffRisks(prAnalysis) : [];

  return (
    <div>
      {risks.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/25 bg-warning/[0.04] p-3">
          <p className="text-[11px] font-semibold text-warning uppercase tracking-wide flex items-center gap-1 mb-1.5">
            <AlertCircle className="w-3 h-3" />
            PR Diff&apos;ten Tespit Edilen Riskli Noktalar ({risks.length})
          </p>
          <ul className="space-y-1">
            {risks.map((r, i) => (
              <li key={i} className="text-[11px] text-warning/80 leading-relaxed flex items-start gap-1.5">
                <span className="text-warning/60 mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={onToggleAll}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span
            className={cn(
              "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
              allSelected ? "bg-primary border-primary" : "border-border hover:border-primary/50"
            )}
          >
            {allSelected && (
              <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
                <path
                  d="M1.5 5l2.5 2.5 4.5-4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
          Tümünü seç
        </button>
        <span className="text-xs text-muted-foreground">
          {selectedIds.size}/{cases.length} seçili
        </span>
      </div>

      {happyPaths.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary inline-block" />
            Happy Paths ({happyPaths.length})
          </p>
          <div className="space-y-2">
            {happyPaths.map((tc) => (
              <CasePreviewCard
                key={tc.id}
                tc={tc}
                selected={selectedIds.has(tc.id)}
                onToggle={() => onToggle(tc.id)}
              />
            ))}
          </div>
        </div>
      )}

      {edgeCases.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary/60 inline-block" />
            Edge Cases ({edgeCases.length})
          </p>
          <div className="space-y-2">
            {edgeCases.map((tc) => (
              <CasePreviewCard
                key={tc.id}
                tc={tc}
                selected={selectedIds.has(tc.id)}
                onToggle={() => onToggle(tc.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
