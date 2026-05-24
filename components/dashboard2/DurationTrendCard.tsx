"use client";

import { useMemo } from "react";
import type { Run } from "@/lib/mockData";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  runs: Run[];
}

function parseDurationToSec(d: string): number {
  if (!d) return 0;
  let total = 0;
  const m = d.match(/(\d+)m/);
  const s = d.match(/(\d+)s/);
  if (m) total += parseInt(m[1]) * 60;
  if (s) total += parseInt(s[1]);
  return total;
}

function formatSec(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

interface Comp {
  name: string;
  prevAvgSec: number;
  currAvgSec: number;
  deltaPct: number;
  runsCount: number;
}

export function DurationTrendCard({ runs }: Props) {
  const items = useMemo<Comp[]>(() => {
    const byName = new Map<string, Run[]>();
    for (const r of runs) {
      const key = r.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(r);
    }

    const out: Comp[] = [];
    Array.from(byName.entries()).forEach(([name, group]) => {
      // Need at least 3 runs to compare halves; sorted DESC by date
      const sorted = [...group].sort((a, b) => b.date.localeCompare(a.date));
      if (sorted.length < 3) return;

      const half = Math.floor(sorted.length / 2);
      const recent = sorted.slice(0, half);
      const older = sorted.slice(half);

      const avg = (arr: Run[]) =>
        arr.reduce((s, r) => s + parseDurationToSec(r.duration), 0) / Math.max(arr.length, 1);

      const currAvg = avg(recent);
      const prevAvg = avg(older);
      if (currAvg === 0 || prevAvg === 0) return;

      const deltaPct = Math.round(((currAvg - prevAvg) / prevAvg) * 100);
      out.push({
        name,
        prevAvgSec: prevAvg,
        currAvgSec: currAvg,
        deltaPct,
        runsCount: sorted.length,
      });
    });

    // Sort by largest slowdown first (positive delta = slower)
    out.sort((a, b) => b.deltaPct - a.deltaPct);
    return out.slice(0, 5);
  }, [runs]);

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Süre trendi</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          En çok yavaşlayan (veya hızlanan) ilk 5 test
        </p>
      </div>

      {items.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Karşılaştırma için yeterli koşum yok
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((it) => {
            const slower = it.deltaPct > 5;
            const faster = it.deltaPct < -5;
            const Icon = slower ? TrendingUp : faster ? TrendingDown : Minus;
            const color = slower
              ? "text-destructive"
              : faster
              ? "text-success"
              : "text-muted-foreground";
            const bgColor = slower
              ? "bg-destructive/10"
              : faster
              ? "bg-success/10"
              : "bg-muted/40";
            return (
              <div
                key={it.name}
                className={`rounded-md px-3 py-2 ${bgColor}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span
                    className="text-xs text-foreground truncate max-w-[60%]"
                    title={it.name}
                  >
                    {it.name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold ${color}`}
                  >
                    <Icon className="w-3 h-3" />
                    {it.deltaPct > 0 ? "+" : ""}
                    {it.deltaPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    Önceki ort: <span className="font-medium">{formatSec(it.prevAvgSec)}</span>
                  </span>
                  <span>
                    Şimdiki ort: <span className="font-medium">{formatSec(it.currAvgSec)}</span>
                  </span>
                  <span>{it.runsCount} run</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
