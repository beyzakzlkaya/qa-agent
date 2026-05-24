"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History, AlertCircle, Loader2, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PreviousIteration,
  PreviousIterationsResp,
} from "@/app/api/jira/previous-iterations/[key]/route";

interface Props {
  taskKey: string;
  reopenCount: number;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 7) return `${Math.floor(diffDays / 7)} hafta önce`;
  if (diffDays > 0) return `${diffDays} gün önce`;
  if (diffHours > 0) return `${diffHours} saat önce`;
  return `${diffMins} dakika önce`;
}

function IterationCard({ iter }: { iter: PreviousIteration }) {
  const [expanded, setExpanded] = useState(false);
  const isAllPassed = iter.failedCases === 0 && iter.passedCases > 0;
  const summary =
    iter.totalCases > 0
      ? `${iter.passedCases}/${iter.totalCases} test geçti`
      : "test sonucu yok";

  return (
    <div
      className={cn(
        "border rounded-lg p-3",
        isAllPassed ? "border-success/20 bg-success/[0.04]" : "border-warning/25 bg-warning/[0.04]"
      )}
    >
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-xs font-mono font-semibold text-foreground">
          İterasyon #{iter.iterationIndex}
        </span>
        {isAllPassed ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-success/10 text-success border-success/20">
            <CheckCircle2 className="w-3 h-3" />
            Tümü geçti
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-warning/10 text-warning border-warning/20">
            <AlertCircle className="w-3 h-3" />
            {iter.failedCases} fail
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">{timeAgo(iter.startedAt)}</span>
        <Link
          href={`/run/${iter.runId}`}
          className="ml-auto text-[11px] text-primary hover:underline"
        >
          Run detayı →
        </Link>
      </div>

      <p className="text-xs text-foreground/85 leading-relaxed">{summary}</p>

      {iter.reopenReason && (
        <p className="text-[11px] text-warning/80 mt-1.5 leading-relaxed">
          <span className="font-medium">Reopen sebebi:</span> {iter.reopenReason}
        </p>
      )}

      {iter.failedDetails.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-2 transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {iter.failedDetails.length} fail detayı
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5 pl-3 border-l border-warning/25">
              {iter.failedDetails.map((d) => (
                <li key={d.caseId} className="text-[11px]">
                  <span className="font-mono text-foreground/70">{d.caseId}</span>
                  {(d.errorMessage || d.anomalyHint) && (
                    <p className="text-muted-foreground leading-relaxed mt-0.5">
                      {d.anomalyHint ?? d.errorMessage}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function PreviousIterationsPanel({ taskKey, reopenCount }: Props) {
  const [iterations, setIterations] = useState<PreviousIteration[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jira/previous-iterations/${taskKey}`);
        const json = (await res.json()) as PreviousIterationsResp & { error?: string };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setErr(json.error ?? "İterasyon geçmişi alınamadı");
        } else {
          setIterations(json.iterations);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  // İterasyon yok ve reopen yok → hiç gösterme (gürültü oluşturmasın)
  if (!loading && (!iterations || iterations.length === 0) && reopenCount === 0) {
    return null;
  }

  return (
    <div className="border border-border bg-card rounded-lg p-4 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Önceki QA İterasyonları</h3>
        {reopenCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-destructive/10 text-destructive border-destructive/20 uppercase tracking-wide">
            Reopen #{reopenCount}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          İterasyonlar yükleniyor...
        </div>
      )}

      {err && !loading && (
        <p className="text-xs text-destructive">{err}</p>
      )}

      {!loading && iterations && iterations.length === 0 && reopenCount > 0 && (
        <p className="text-xs text-muted-foreground italic">
          JIRA changelog&apos;a göre task QA&apos;den {reopenCount} kez döndü, ancak yerel sistemde
          önceki run kaydı bulunamadı.
        </p>
      )}

      {!loading && iterations && iterations.length > 0 && (
        <div className="space-y-2">
          {iterations.map((iter) => (
            <IterationCard key={iter.runId} iter={iter} />
          ))}
        </div>
      )}
    </div>
  );
}
