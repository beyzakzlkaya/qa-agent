"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { DailyTrendRow } from "@/lib/db/queries";

interface TrendResp {
  dailyTrend: DailyTrendRow[];
}

export function EnhancedPassRateTrend() {
  const [rows, setRows] = useState<DailyTrendRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/trend")
      .then((r) => r.json())
      .then((d: TrendResp) => {
        if (!cancelled) setRows(d.dailyTrend ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useMemo(() => {
    return rows.map((r, i) => {
      // 7-day moving average
      const start = Math.max(0, i - 6);
      const window = rows.slice(start, i + 1);
      const avg =
        window.reduce((sum, x) => sum + (x.passRate ?? 0), 0) / Math.max(window.length, 1);
      return {
        date: r.date,
        passRate: r.passRate,
        ma7: Math.round(avg * 10) / 10,
      };
    });
  }, [rows]);

  function barColor(rate: number): string {
    if (rate >= 80) return "hsl(var(--success))";
    if (rate >= 50) return "hsl(var(--warning))";
    return "hsl(var(--destructive))";
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Başarı oranı trendi (14 gün)
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Günlük bar + 7g hareketli ortalama · %80 hedef çizgisi
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-success" /> ≥ 80
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-warning" /> 50-79
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-destructive" /> &lt; 50
          </span>
        </div>
      </div>
      <div className="h-56">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Yükleniyor...
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Son 14 günde test koşumu yok
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.2)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                domain={[0, 100]}
                unit="%"
                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--tooltip-bg, #fff)",
                  border: "1px solid rgba(229,229,227,0.5)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--tooltip-text, #111)",
                }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any, name: any) => {
                  const labels: Record<string, string> = {
                    passRate: "Pass rate",
                    ma7: "7g ort.",
                  };
                  return [`${v}%`, labels[name as string] ?? name];
                }}
              />
              <ReferenceLine
                y={80}
                stroke="hsl(var(--success))"
                strokeDasharray="4 4"
                strokeWidth={1.2}
                label={{
                  value: "Hedef %80",
                  position: "right",
                  fill: "hsl(var(--success))",
                  fontSize: 10,
                }}
              />
              <Bar dataKey="passRate" radius={[3, 3, 0, 0]} barSize={14}>
                {data.map((d, i) => (
                  <Cell key={i} fill={barColor(d.passRate)} />
                ))}
              </Bar>
              <Line
                dataKey="ma7"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                type="monotone"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
