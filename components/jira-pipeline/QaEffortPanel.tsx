"use client";

import { useState } from "react";
import {
  Timer,
  Loader2,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { QaEffortResponse } from "@/app/api/jira/qa-effort/[key]/route";

interface Props {
  taskKey: string;
}

type State =
  | { phase: "idle" }
  | { phase: "loading"; stage: "generating" | "estimating" }
  | { phase: "ready"; data: QaEffortResponse }
  | { phase: "error"; message: string };

function formatMinutes(min: number): { value: string; unit: string } {
  if (min < 60) return { value: String(min), unit: "dk" };
  const hours = min / 60;
  if (hours < 10) return { value: hours.toFixed(1).replace(/\.0$/, ""), unit: "saat" };
  return { value: String(Math.round(hours)), unit: "saat" };
}

function ConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const styles = {
    low: {
      cls: "bg-warning/10 text-warning border-warning/20",
      label: "Düşük güven",
      Icon: TrendingDown,
    },
    medium: {
      cls: "bg-muted text-muted-foreground border-border",
      label: "Orta güven",
      Icon: Minus,
    },
    high: {
      cls: "bg-success/10 text-success border-success/20",
      label: "Yüksek güven",
      Icon: TrendingUp,
    },
  }[confidence];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide",
        styles.cls
      )}
    >
      <styles.Icon className="w-3 h-3" />
      {styles.label}
    </span>
  );
}

function BreakdownBar({
  label,
  minutes,
  total,
  color,
}: {
  label: string;
  minutes: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((minutes / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{minutes} dk</span>
      </div>
      <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function QaEffortPanel({ taskKey }: Props) {
  const [state, setState] = useState<State>({ phase: "idle" });

  const runEstimate = async (fresh = false) => {
    setState({ phase: "loading", stage: "generating" });

    // Cache hit ihtimaline karşı kısa bir gecikme sonrası "estimating" aşamasına geç
    const stageTimer = setTimeout(() => {
      setState((s) => (s.phase === "loading" ? { phase: "loading", stage: "estimating" } : s));
    }, 8000);

    try {
      const res = await fetch(
        `/api/jira/qa-effort/${taskKey}${fresh ? "?fresh=1" : ""}`,
        { method: "POST" }
      );
      clearTimeout(stageTimer);
      const data = (await res.json()) as QaEffortResponse & { error?: string };
      if (!res.ok || data.error) {
        setState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ phase: "ready", data });
    } catch (err) {
      clearTimeout(stageTimer);
      setState({ phase: "error", message: (err as Error).message ?? "Bağlantı hatası" });
    }
  };

  return (
    <div className="border border-warning/25 bg-warning/[0.05] rounded-lg p-4 mb-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-7 h-7 rounded-md bg-warning/15 flex items-center justify-center mt-0.5">
          <Timer className="w-3.5 h-3.5 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">Tahmini QA Eforu</h3>
            {state.phase === "ready" && (
              <>
                <ConfidenceBadge confidence={state.data.confidence} />
                {state.data.cached && (
                  <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                    cache&apos;den
                  </span>
                )}
              </>
            )}
            {state.phase === "ready" && (
              <button
                type="button"
                onClick={() => runEstimate(true)}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title="Test caseleri yeniden üret ve tekrar tahmin et"
              >
                <RefreshCw className="w-3 h-3" />
                Yenile
              </button>
            )}
          </div>

          {state.phase === "idle" && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                Test caseler üretilir, ardından task içeriği + PR + üretilen caseler
                LLM&apos;e gönderilerek manuel QA için tahmini efor hesaplanır.
                İlk hesaplama 30-90 saniye sürebilir.
              </p>
              <button
                type="button"
                onClick={() => runEstimate(false)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-warning text-warning-foreground text-xs font-medium hover:bg-warning/90 transition-colors"
              >
                <Timer className="w-3.5 h-3.5" />
                QA Eforunu Tahmin Et
              </button>
            </div>
          )}

          {state.phase === "loading" && (
            <div className="flex items-start gap-2 text-xs text-warning/90">
              <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-spin" />
              <div>
                <p className="font-medium">
                  {state.stage === "generating"
                    ? "Test caseler üretiliyor..."
                    : "LLM efor tahmini yapıyor..."}
                </p>
                <p className="text-warning/60 mt-0.5">
                  JIRA + GitHub + LLM çağrıları sırayla işleniyor — 30-90 sn sürebilir.
                </p>
              </div>
            </div>
          )}

          {state.phase === "error" && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p>{state.message}</p>
                <button
                  type="button"
                  onClick={() => runEstimate(false)}
                  className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Tekrar dene
                </button>
              </div>
            </div>
          )}

          {state.phase === "ready" && (
            <div className="space-y-4">
              {/* Toplam */}
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                    Toplam tahmin
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-foreground tabular-nums">
                      {formatMinutes(state.data.totalMinutes).value}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatMinutes(state.data.totalMinutes).unit}
                    </span>
                  </div>
                </div>
                <div className="border-l border-border/60 pl-3 py-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                    Test case
                  </p>
                  <span className="text-sm font-semibold text-foreground">
                    {state.data.caseCount} adet
                  </span>
                </div>
              </div>

              {/* Breakdown bars */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <BreakdownBar
                  label="Setup"
                  minutes={state.data.breakdown.setupMin}
                  total={state.data.totalMinutes}
                  color="bg-primary/70"
                />
                <BreakdownBar
                  label="Execution"
                  minutes={state.data.breakdown.executionMin}
                  total={state.data.totalMinutes}
                  color="bg-success/70"
                />
                <BreakdownBar
                  label="Regression"
                  minutes={state.data.breakdown.regressionMin}
                  total={state.data.totalMinutes}
                  color="bg-warning/70"
                />
                <BreakdownBar
                  label="Exploratory"
                  minutes={state.data.breakdown.exploratoryMin}
                  total={state.data.totalMinutes}
                  color="bg-destructive/60"
                />
              </div>

              {/* Rationale */}
              {state.data.rationale && (
                <p className="text-xs text-foreground/80 leading-relaxed">
                  {state.data.rationale}
                </p>
              )}

              {/* Drivers */}
              {state.data.drivers.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    Etkili faktörler
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {state.data.drivers.map((d, i) => (
                      <span
                        key={i}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-muted/60 text-foreground/80 border border-border/40"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
