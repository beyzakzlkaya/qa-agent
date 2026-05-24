"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyTrendRow, TestCaseHealthRow } from "@/lib/db/queries";

interface TrendData {
  dailyTrend: DailyTrendRow[];
  testCaseHealth: TestCaseHealthRow[];
}

function cellColor(passRate: number): string {
  if (passRate > 70) return "hsl(var(--chart-2, 142 76% 36%))";
  if (passRate > 40) return "hsl(var(--warning, 38 92% 50%))";
  return "hsl(var(--destructive, 0 84.2% 60.2%))";
}

export function TrendCharts() {
  const [data, setData] = useState<TrendData | null>(null);

  useEffect(() => {
    fetch("/api/reports/trend")
      .then((r) => r.json())
      .then((d: TrendData) => setData(d))
      .catch(() => {});
  }, []);

  if (!data || (data.dailyTrend.length === 0 && data.testCaseHealth.length === 0)) {
    return null;
  }

  return (
    <>
      {data.dailyTrend.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Pass rate trendi (14 gün)</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Günlük test başarı oranı</p>
          </div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
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
                  formatter={(v: any) => [`${v}%`, "Pass rate"]}
                />
                <Line
                  dataKey="passRate"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {data.testCaseHealth.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Test case sağlık durumu</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Son 30 günde en düşük pass rate</p>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.testCaseHealth.slice(0, 8)}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
              >
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  dataKey="test_case_id"
                  type="category"
                  width={88}
                  tick={{ fontSize: 9, fill: "#9CA3AF" }}
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
                  formatter={(v: any) => [`${v}%`, "Pass rate"]}
                />
                <Bar dataKey="passRate" radius={[0, 3, 3, 0]}>
                  {data.testCaseHealth.slice(0, 8).map((entry, i) => (
                    <Cell key={i} fill={cellColor(entry.passRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </>
  );
}
