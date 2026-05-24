"use client";

import { useState } from "react";
import { GitPullRequest, ExternalLink, ChevronDown, ChevronUp, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FullTaskContext } from "@/app/api/jira/full-context/[key]/route";

interface Props {
  ctx: FullTaskContext;
}

export function PrChangesPanel({ ctx }: Props) {
  const [expanded, setExpanded] = useState(false);
  const enrichment = ctx.enrichment;
  const pr = enrichment.pr;
  const modules = enrichment.modules;

  if (!pr) {
    return (
      <div className="border border-border bg-card rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <GitPullRequest className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Değişiklikler</h3>
        </div>
        <div className="bg-warning/5 border border-warning/20 rounded p-2.5">
          <p className="text-xs text-warning/80">
            {enrichment.stuckReason?.message ?? "Bu task'a bağlı GitHub PR bulunamadı."}
          </p>
        </div>
      </div>
    );
  }

  const stateLabel: Record<typeof pr.state, { text: string; cls: string }> = {
    open:   { text: "Açık",     cls: "bg-success/10 text-success border-success/20" },
    merged: { text: "Merged",   cls: "bg-primary/10 text-primary border-primary/20" },
    closed: { text: "Kapalı",   cls: "bg-muted text-muted-foreground border-border" },
    mixed:  { text: "Karışık",  cls: "bg-warning/10 text-warning border-warning/20" },
  };

  const allTopFiles = pr.topFiles;
  const filesToShow = expanded ? allTopFiles : allTopFiles.slice(0, 5);
  const hasMore = pr.fileCount > filesToShow.length;

  return (
    <div className="border border-border bg-card rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <GitPullRequest className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Değişiklikler</h3>
        <span className="text-xs text-muted-foreground">
          {pr.count} PR • {pr.fileCount} dosya
        </span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide",
            stateLabel[pr.state].cls
          )}
        >
          {stateLabel[pr.state].text}
        </span>
        <a
          href={pr.primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3 h-3" />#{pr.primaryNumber}
        </a>
      </div>

      {/* Diff totals */}
      <div className="flex items-center gap-3 mb-3 text-[11px] font-mono">
        <span className="text-success">+{pr.additions}</span>
        <span className="text-destructive">-{pr.deletions}</span>
      </div>

      {/* Affected modules */}
      {modules.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Etkilenen Modüller
          </p>
          <div className="flex flex-wrap gap-1">
            {modules.map((m) => {
              const styles =
                m.tone === "danger"
                  ? "bg-destructive/10 text-destructive border-destructive/20"
                  : m.tone === "warning"
                    ? "bg-warning/10 text-warning border-warning/20"
                    : "bg-primary/5 text-primary/80 border-primary/15";
              return (
                <span
                  key={m.label}
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border font-medium inline-flex items-center gap-1",
                    styles
                  )}
                >
                  {m.label}
                  <span className="opacity-60">×{m.fileCount}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Top files */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          En Çok Değişen Dosyalar
        </p>
        <div className="space-y-1">
          {filesToShow.map((f) => (
            <div key={f.filename} className="flex items-center gap-2 text-[11px]">
              <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="font-mono text-foreground/75 truncate flex-1" title={f.filename}>
                {f.filename}
              </span>
              <span className="shrink-0 font-mono text-success">+{f.additions}</span>
              <span className="shrink-0 font-mono text-destructive">-{f.deletions}</span>
            </div>
          ))}
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-2"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Daha az göster
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />+{pr.fileCount - filesToShow.length} dosya daha
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
