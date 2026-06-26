"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, AlertTriangle, CheckCircle2 } from "lucide-react";

interface TopCase {
  caseId: string;
  title: string | null;
  failCount: number;
  totalRuns: number;
}

interface ModuleMetric {
  domain: string;
  label: string;
  totalCases: number;
  distinctCases: number;
  failedCases: number;
  passedCases: number;
  passRate: number;
  defectDensity: number;
  hasEnoughSamples: boolean;
  isCustom?: boolean;
  topFailingCases: TopCase[];
}

interface Resp {
  modules: ModuleMetric[];
  windowDays: number;
}

type HealthLevel = "critical" | "warning" | "ok";

function healthLevel(failPct: number): HealthLevel {
  if (failPct >= 40) return "critical";
  if (failPct >= 10) return "warning";
  return "ok";
}

const HEALTH_STYLE: Record<
  HealthLevel,
  { color: string; bg: string; label: string; icon: JSX.Element }
> = {
  critical: {
    color: "hsl(var(--destructive))",
    bg: "bg-destructive/10 text-destructive border-destructive/30",
    label: "Acil",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  warning: {
    color: "hsl(var(--warning))",
    bg: "bg-warning/10 text-warning border-warning/30",
    label: "Dikkat",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  ok: {
    color: "hsl(var(--success))",
    bg: "bg-success/10 text-success border-success/30",
    label: "İyi",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
};

export function ModuleHeatmap() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/modules?days=30")
      .then((r) => r.json())
      .then((d: Resp) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(() => data?.modules ?? [], [data]);
  const { primary, lowSample } = useMemo(() => {
    const primary = modules.filter((m) => m.hasEnoughSamples);
    const lowSample = modules.filter((m) => !m.hasEnoughSamples);
    return { primary, lowSample };
  }, [modules]);

  // Summary sentence — the "ne yapmalıyım?" answer.
  // Pick the worst real module (skipping custom/ad-hoc) for the lead.
  const worstReal = useMemo(
    () => primary.find((m) => !m.isCustom) ?? null,
    [primary]
  );

  const maxDensity = useMemo(
    () => primary.reduce((m, x) => Math.max(m, x.defectDensity), 0) || 1,
    [primary]
  );

  const renderRow = (m: ModuleMetric, isMuted: boolean) => {
    const widthPct = isMuted
      ? Math.max(m.defectDensity, 2)
      : Math.max((m.defectDensity / maxDensity) * 100, 2);
    const level = healthLevel(m.defectDensity);
    const style = HEALTH_STYLE[level];
    const isOpen = expanded === m.domain;
    return (
      <div key={m.domain}>
        <button
          onClick={() => setExpanded(isOpen ? null : m.domain)}
          className="w-full text-left hover:bg-accent/50 rounded-md px-2 py-1.5 transition-colors"
        >
          <div className="flex items-center justify-between mb-1 gap-2">
            <span
              className={`text-xs flex items-center gap-1.5 min-w-0 ${
                isMuted ? "text-muted-foreground/70" : "text-foreground"
              }`}
            >
              {isOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span className="font-medium truncate">{m.label}</span>
              {!isMuted && (
                <span
                  className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${style.bg}`}
                >
                  {style.icon}
                  {style.label}
                </span>
              )}
              {m.isCustom && (
                <span
                  className="text-[9px] uppercase tracking-wider text-muted-foreground/70"
                  title="Prompt sayfasından elle başlatılan ad-hoc denemeler"
                >
                  · ad-hoc
                </span>
              )}
            </span>
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {m.totalCases} koşumda {m.failedCases} hata
              </span>
              <span
                className="text-sm font-semibold tabular-nums w-12 text-right"
                style={{ color: isMuted ? "hsl(var(--muted-foreground))" : style.color }}
              >
                %{Math.round(m.defectDensity)}
              </span>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${widthPct}%`,
                backgroundColor: isMuted ? "hsl(var(--muted-foreground))" : style.color,
                opacity: isMuted ? 0.35 : 0.85,
              }}
            />
          </div>
        </button>
        {isOpen && m.topFailingCases.length > 0 && (
          <div className="mt-1.5 ml-5 mb-2 space-y-1 pr-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 pt-1">
              Önce bu testleri incele
            </p>
            {m.topFailingCases.map((c) => {
              const pct = Math.round((c.failCount / c.totalRuns) * 100);
              return (
                <div
                  key={c.caseId}
                  className="flex items-center justify-between text-[11px] py-1 border-b border-border/40 last:border-b-0 gap-3"
                >
                  <span
                    className="truncate text-muted-foreground min-w-0"
                    title={c.title ?? c.caseId}
                  >
                    <span className="font-mono text-foreground/70">{c.caseId}</span>
                    {c.title && <span className="ml-1">— {c.title}</span>}
                  </span>
                  <span className="text-destructive font-medium tabular-nums shrink-0">
                    {c.totalRuns} koşumdan {c.failCount}&apos;i hata · %{pct}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Hangi modülde test başarısızlığı yüksek?
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Son 30 gün — hata oranı yüksek modülleri önce incele
        </p>
      </div>

      {/* Lead sentence — "şu an dikkat etmen gereken" */}
      {!loading && worstReal && (
        <div
          className={`rounded-md border px-3 py-2 text-[11px] flex items-start gap-2 ${
            HEALTH_STYLE[healthLevel(worstReal.defectDensity)].bg
          }`}
        >
          {HEALTH_STYLE[healthLevel(worstReal.defectDensity)].icon}
          <span>
            En problemli modül: <strong>{worstReal.label}</strong> — son 30 günde {worstReal.totalCases}{" "}
            koşumdan {worstReal.failedCases}&apos;i hata verdi (%{Math.round(worstReal.defectDensity)}).
            {worstReal.topFailingCases[0] && (
              <>
                {" "}En kötü test: <span className="font-mono">{worstReal.topFailingCases[0].caseId}</span>
                {worstReal.topFailingCases[0].title && ` (${worstReal.topFailingCases[0].title})`}.
              </>
            )}
          </span>
        </div>
      )}

      {loading ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Yükleniyor...
        </div>
      ) : modules.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Son 30 günde kaydedilmiş test sonucu yok
        </div>
      ) : (
        <div className="space-y-2">
          {primary.length > 0 ? (
            primary.map((m) => renderRow(m, false))
          ) : (
            <p className="text-[11px] text-muted-foreground italic py-2">
              Yorum yapacak kadar test koşulmamış — modüllerin en az 5 koşumu yok
            </p>
          )}

          {lowSample.length > 0 && (
            <details className="pt-2 border-t border-border/50">
              <summary className="text-[11px] text-muted-foreground/80 cursor-pointer hover:text-foreground flex items-center gap-1.5 py-1">
                <Info className="w-3 h-3" />
                Az veri ({lowSample.length} modül) — yorum yapmak için 5&apos;ten az koşum, sıralanmıyor
              </summary>
              <div className="mt-2 space-y-2 opacity-80">
                {lowSample.map((m) => renderRow(m, true))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 pt-2 border-t border-border/50">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5 text-success" />
          İyi (&lt; %10)
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5 text-warning" />
          Dikkat (%10–40)
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5 text-destructive" />
          Acil (&gt; %40)
        </span>
      </div>
    </div>
  );
}
