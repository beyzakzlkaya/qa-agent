"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Sparkles, Activity, AlertTriangle, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PipelineOverviewCounter,
  PipelineOverviewResp,
} from "@/app/api/jira/pipeline-overview/route";

const ICONS: Record<PipelineOverviewCounter["key"], React.ComponentType<{ className?: string }>> = {
  ready: GitBranch,
  generating: Sparkles,
  inQa: Activity,
  stuck: AlertTriangle,
  rtrToday: CheckCircle2,
};

const TONE_STYLES: Record<PipelineOverviewCounter["tone"], string> = {
  default: "border-border bg-card text-foreground hover:border-primary/30",
  info: "border-primary/25 bg-primary/5 text-foreground hover:border-primary/40",
  warning: "border-warning/30 bg-warning/8 text-foreground hover:border-warning/50",
  success: "border-success/25 bg-success/8 text-foreground hover:border-success/40",
};

const TONE_ICON_STYLES: Record<PipelineOverviewCounter["tone"], string> = {
  default: "text-muted-foreground",
  info: "text-primary",
  warning: "text-warning",
  success: "text-success",
};

const TONE_COUNT_STYLES: Record<PipelineOverviewCounter["tone"], string> = {
  default: "text-foreground",
  info: "text-primary",
  warning: "text-warning",
  success: "text-success",
};

interface Props {
  /** Auto-refresh aralığı (ms) — 0 ise refresh kapalı */
  refreshIntervalMs?: number;
}

export function PipelineStatusStrip({ refreshIntervalMs = 30_000 }: Props) {
  const [data, setData] = useState<PipelineOverviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const res = await fetch("/api/jira/pipeline-overview");
        const json = (await res.json()) as PipelineOverviewResp & { error?: string };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setErr(json.error ?? "Pipeline durumu alınamadı");
          setLoading(false);
          return;
        }
        setData(json);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErr((e as Error).message);
        setLoading(false);
      }
    };

    load();
    if (refreshIntervalMs > 0) {
      timer = setInterval(load, refreshIntervalMs);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [refreshIntervalMs]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="border border-border bg-card rounded-lg p-3 flex items-center gap-3"
          >
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <div className="h-3 w-12 bg-muted/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (err || !data?.available) {
    return (
      <div className="border border-dashed border-border bg-card/40 rounded-lg p-3 text-xs text-muted-foreground mb-6">
        Pipeline durum verisi alınamadı{err ? `: ${err}` : " — JIRA bağlantısını kontrol et."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-6">
      {data.counters.map((c) => {
        const Icon = ICONS[c.key];
        const content = (
          <div
            className={cn(
              "border rounded-lg p-3 transition-all cursor-pointer h-full",
              TONE_STYLES[c.tone],
              c.count === 0 && "opacity-60"
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("w-4 h-4 shrink-0", TONE_ICON_STYLES[c.tone])} />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {c.label}
              </span>
            </div>
            <p className={cn("text-2xl font-semibold mt-1 leading-none", TONE_COUNT_STYLES[c.tone])}>
              {c.count}
            </p>
          </div>
        );
        return c.jiraUrl ? (
          <a
            key={c.key}
            href={c.jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
            title={`JIRA'da göster: ${c.label}`}
          >
            {content}
          </a>
        ) : (
          <div key={c.key}>{content}</div>
        );
      })}
    </div>
  );
}
