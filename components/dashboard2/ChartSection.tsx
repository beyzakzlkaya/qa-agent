"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { hourlyData } from "@/lib/mockData";
import { Run } from "@/lib/mockData";

export function HourlyChart() {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">Saatlik run akışı</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={hourlyData}
            margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            barSize={20}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.2)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "#9CA3AF" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9CA3AF" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--tooltip-bg, #fff)",
                border: "1px solid rgba(229,229,227,0.5)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--tooltip-text, #111)",
              }}
              cursor={{ fill: "rgba(156,163,175,0.1)" }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) => [`${value ?? ""}`, "Başarısız"]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={() => "Başarısız Test Sayısı"}
            />
            <Bar dataKey="failures" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function parseDurationToMinutes(duration: string): number {
  if (!duration || duration === "0s") return 0;
  let total = 0;
  const minMatch = duration.match(/(\d+)m/);
  const secMatch = duration.match(/(\d+)s/);
  if (minMatch) total += parseInt(minMatch[1]);
  if (secMatch) total += parseInt(secMatch[1]) / 60;
  return total;
}

interface Props {
  runs: Run[];
}

export function DurationAnalysis({ runs }: Props) {
  const sorted = [...runs]
    .map((r) => ({ ...r, minutes: parseDurationToMinutes(r.duration) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);

  const max = sorted[0]?.minutes ?? 1;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">Süre analizi</h3>
      <div className="space-y-3">
        {sorted.map((run) => {
          const pct = Math.max((run.minutes / max) * 100, 2);
          const isSlow = run.minutes >= 60;
          return (
            <div key={run.id}>
              <div className="flex items-center justify-between mb-1">
                <span
                  className="text-[11px] text-foreground/80 truncate max-w-[65%]"
                  title={run.name}
                >
                  {run.name}
                </span>
                <span
                  className={`text-[11px] font-semibold ${
                    isSlow ? "text-warning" : "text-muted-foreground"
                  }`}
                >
                  {run.duration}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isSlow ? "hsl(var(--warning))" : "hsl(var(--primary))",
                    opacity: 0.7,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground/70 mt-1">
        <span className="inline-block w-2 h-2 rounded-full bg-warning mr-1" />
        Sarı = 60 dk üzeri
      </p>
    </div>
  );
}
