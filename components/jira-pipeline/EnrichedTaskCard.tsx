"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Clock,
  User,
  ExternalLink,
  ArrowRight,
  AlertTriangle,
  RotateCcw,
  GitPullRequest,
  Sparkles,
  ChevronsRight,
  Loader2,
  FileCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { JiraTask } from "@/app/api/jira/tasks/route";
import type { JiraTaskEnrichment } from "@/lib/jira-pipeline/task-enrichment";

const SLA_WARN_HOURS = 24;

// ── Badge components ─────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    highest: "bg-destructive/10 text-destructive border-destructive/20",
    high: "bg-warning/10 text-warning border-warning/20",
    medium: "bg-warning/5 text-warning/80 border-warning/15",
    low: "bg-success/10 text-success border-success/20",
    lowest: "bg-primary/10 text-primary border-primary/20",
  };
  const key = priority.toLowerCase();
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide",
        styles[key] ?? styles.medium
      )}
    >
      {priority}
    </span>
  );
}

function ReopenBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-destructive/10 text-destructive border-destructive/25 uppercase tracking-wide"
      title={`Bu task QA'den ${count} kez geri döndü`}
    >
      <RotateCcw className="w-3 h-3" />
      Reopen #{count}
    </span>
  );
}

function SlaBadge({ hours }: { hours: number }) {
  const days = Math.floor(hours / 24);
  const label = days > 0 ? `${days}g+` : `${Math.floor(hours)}s`;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-warning/10 text-warning border-warning/25 uppercase tracking-wide"
      title={`READY FOR QA'de ${Math.floor(hours)} saattir bekliyor`}
    >
      <Clock className="w-3 h-3" />
      SLA {label}
    </span>
  );
}

function ComplexityBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-warning/5 text-warning/80 border-warning/20 uppercase tracking-wide"
      title="Yüksek karmaşıklık: 20+ dosya veya 3+ modül"
    >
      <ChevronsRight className="w-3 h-3" />
      Yüksek karmaşıklık
    </span>
  );
}

function TimeAgo({ iso }: { iso: string }) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let label: string;
  if (diffDays > 0) label = `${diffDays}g önce`;
  else if (diffHours > 0) label = `${diffHours}s önce`;
  else if (diffMins > 0) label = `${diffMins}dk önce`;
  else label = "az önce";

  return <span className="text-[11px] text-muted-foreground">{label}</span>;
}

// ── Module pills ─────────────────────────────────────────────────────────────

function ModulePill({ label, tone }: { label: string; tone: string }) {
  const styles =
    tone === "danger"
      ? "bg-destructive/10 text-destructive border-destructive/20"
      : tone === "warning"
        ? "bg-warning/10 text-warning border-warning/20"
        : "bg-primary/5 text-primary/80 border-primary/15";
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded border font-medium",
        styles
      )}
    >
      {label}
    </span>
  );
}

// ── EnrichedTaskCard ─────────────────────────────────────────────────────────

interface Props {
  task: JiraTask;
  onSelect: () => void;
  onDefer: (key: string) => void;
  /** Seçili QA Engineer — task.qaAssignee eşleşirse görsel vurgu */
  highlightAssignee?: string;
}

interface EnrichmentResp {
  enrichment: JiraTaskEnrichment;
  cached?: boolean;
}

export function EnrichedTaskCard({ task, onSelect, onDefer, highlightAssignee }: Props) {
  const [enrichment, setEnrichment] = useState<JiraTaskEnrichment | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // IntersectionObserver ile lazy load — kart görünür olunca tetikle
  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.unobserve(node);
            break;
          }
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const loadEnrichment = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/jira/task-enrichment/${task.key}?updated=${encodeURIComponent(task.updated)}`
      );
      const json = (await res.json()) as EnrichmentResp & { error?: string };
      if (!res.ok || json.error) {
        return;
      }
      setEnrichment(json.enrichment);
    } catch {
      // silent — kart hâlâ temel bilgileri gösterir
    } finally {
      setLoading(false);
    }
  }, [task.key, task.updated]);

  useEffect(() => {
    if (visible && !enrichment && !loading) {
      loadEnrichment();
    }
  }, [visible, enrichment, loading, loadEnrichment]);

  const hasStuck = !!enrichment?.stuckReason;
  const isMine = highlightAssignee && task.qaAssignee === highlightAssignee;

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={cn(
        "group border rounded-lg p-4 cursor-pointer transition-all duration-150",
        hasStuck
          ? "border-warning/35 bg-warning/[0.04] hover:border-warning/55"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/[0.02]",
        isMine && "ring-1 ring-primary/30"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Top row: badges */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-xs font-mono font-semibold text-primary">{task.key}</span>
            <PriorityBadge priority={task.priority} />
            {enrichment && enrichment.reopenCount > 0 && (
              <ReopenBadge count={enrichment.reopenCount} />
            )}
            {enrichment && enrichment.waitingHours >= SLA_WARN_HOURS && (
              <SlaBadge hours={enrichment.waitingHours} />
            )}
            {enrichment?.isHighComplexity && <ComplexityBadge />}
            {hasStuck && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-warning/15 text-warning border-warning/30 uppercase tracking-wide">
                <AlertTriangle className="w-3 h-3" />
                Takılı
              </span>
            )}
            <div className="inline-flex items-center gap-2 ml-auto">
              {task.qaAssignee && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium",
                    isMine
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted/40 text-muted-foreground border-border"
                  )}
                  title="QA Engineer"
                >
                  QA: {task.qaAssignee}
                </span>
              )}
              {task.assignee && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <User className="w-3 h-3" />
                  {task.assignee}
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-2">
            {task.summary}
          </p>

          {/* Context metrics — only shown after enrichment loaded */}
          {enrichment && !hasStuck && (
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
              {enrichment.pr && (
                <span className="inline-flex items-center gap-1">
                  <GitPullRequest className="w-3 h-3" />
                  {enrichment.pr.count} PR
                </span>
              )}
              {enrichment.pr && (
                <span className="inline-flex items-center gap-1">
                  <FileCode className="w-3 h-3" />
                  {enrichment.pr.fileCount} dosya
                </span>
              )}
              {enrichment.estimatedCaseCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  ~{enrichment.estimatedCaseCount} test
                </span>
              )}
              {enrichment.modules.length > 0 && (
                <span className="inline-flex items-center gap-1 flex-wrap">
                  {enrichment.modules.slice(0, 3).map((m) => (
                    <ModulePill key={m.label} label={m.label} tone={m.tone} />
                  ))}
                  {enrichment.modules.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{enrichment.modules.length - 3}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Loading state for enrichment */}
          {loading && !enrichment && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
              <Loader2 className="w-3 h-3 animate-spin" />
              PR ve modül bilgisi yükleniyor...
            </div>
          )}

          {/* Stuck reason */}
          {hasStuck && (
            <div className="mt-2 text-[11px] text-warning/80 bg-warning/5 border border-warning/20 rounded p-2 leading-relaxed">
              <p className="font-medium">Otomatik üretim engellendi:</p>
              <p>{enrichment.stuckReason!.message}</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 mt-3">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <TimeAgo iso={task.updated} />
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
              onClick={(e) => {
                e.stopPropagation();
                onDefer(task.key);
              }}
              title="Bu task'ı sonra ele al — listenin altına gönderir"
            >
              Sonra
            </button>
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
              JIRA
            </a>
          </div>
        </div>
        <div className="shrink-0 w-7 h-7 rounded-md bg-primary/5 group-hover:bg-primary/15 flex items-center justify-center transition-colors">
          <ArrowRight className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
    </div>
  );
}
