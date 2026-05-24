"use client";

import { Run } from "@/lib/mockData";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

interface Props {
  runs: Run[];
}

export function FailureDistribution({ runs }: Props) {
  const groups: Record<string, number> = {};
  for (const run of runs) {
    if (run.status === "failed" || run.failed > 0) {
      const key = run.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
      const base = key.startsWith("[JIRA]") ? key.split(":")[0].trim() : key;
      groups[base] = (groups[base] || 0) + run.failed;
    }
  }

  const sorted = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);
  const max = sorted[0]?.[1] ?? 1;
  const runCounts: Record<string, number> = {};
  for (const run of runs) {
    const key = run.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
    const base = key.startsWith("[JIRA]") ? key.split(":")[0].trim() : key;
    runCounts[base] = (runCounts[base] || 0) + 1;
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">
        Hata dağılımı — tür bazında
      </h3>
      <div className="space-y-3">
        {sorted.map(([name, count]) => (
          <div key={name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-foreground/80 truncate max-w-[60%]" title={name}>
                {name}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                  {runCounts[name] ?? 1} run
                </span>
                <span className="text-xs font-semibold text-destructive">{count}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${(count / max) * 100}%`,
                  backgroundColor: "hsl(var(--destructive))",
                  opacity: 0.7 + (count / max) * 0.3,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RecurringFailures({ runs }: Props) {
  const nameCounts: Record<string, number> = {};
  for (const run of runs) {
    if (run.status === "failed") {
      const base = run.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
      nameCounts[base] = (nameCounts[base] || 0) + 1;
    }
  }

  const repeating = Object.entries(nameCounts)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1]);

  const slowRuns = runs.filter((r) => {
    const match = r.duration.match(/^(\d+)m/);
    return match && parseInt(match[1]) >= 60;
  });

  const insights: { icon: "red" | "yellow" | "blue"; title: string; desc: string }[] = [];

  for (const [name, count] of repeating) {
    insights.push({
      icon: count >= 5 ? "red" : "yellow",
      title: `Tekrarlayan: ${name}`,
      desc: `Son ${count} çalışmada başarısız oldu.`,
    });
  }

  for (const run of slowRuns) {
    insights.push({
      icon: "yellow",
      title: `Yavaş Run: ${run.name}`,
      desc: `Süre: ${run.duration} — 60 dk eşiği aşıldı.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: "blue",
      title: "Tekrarlayan başarısızlık yok",
      desc: "Son çalışmalarda kritik tekrarlayan hata tespit edilmedi.",
    });
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">Tekrarlayan başarısızlıklar</h3>
      <div className="space-y-3">
        {insights.slice(0, 6).map((insight, i) => {
          const Icon =
            insight.icon === "red"
              ? AlertCircle
              : insight.icon === "yellow"
              ? AlertTriangle
              : Info;
          const color =
            insight.icon === "red"
              ? "text-destructive bg-destructive/10"
              : insight.icon === "yellow"
              ? "text-warning bg-warning/10"
              : "text-primary bg-primary/10";
          return (
            <div key={i} className="flex items-start gap-3">
              <div className={`p-1.5 rounded-md flex-shrink-0 ${color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground">{insight.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{insight.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
