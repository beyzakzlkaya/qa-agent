"use client";

import { Run } from "@/lib/mockData";

interface KpiCardsProps {
  runs: Run[];
}

export function KpiCards({ runs }: KpiCardsProps) {
  const total = runs.length;
  const passedRuns = runs.filter((r) => r.status === "passed").length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;
  const runningRuns = runs.filter((r) => r.status === "running").length;

  const successRate = total > 0 ? Math.round((passedRuns / total) * 100) : 0;
  const regressionRunning = runs.filter((r) => r.status === "running" && r.type === "Regresyon").length;
  const ozelRunning = runs.filter((r) => r.status === "running" && r.type === "Özel").length;

  const totalFailed = runs.reduce((acc, r) => acc + r.failed, 0);
  const avgErrorPerRun = total > 0 ? (totalFailed / total).toFixed(1) : "0";
  const yesterdayAvg = 3.2;
  const trend = parseFloat(avgErrorPerRun) - yesterdayAvg;

  const rateColor =
    successRate < 30
      ? { bar: "hsl(var(--destructive))", text: "text-destructive", bg: "bg-destructive" }
      : successRate < 70
      ? { bar: "hsl(var(--warning))", text: "text-warning", bg: "bg-warning" }
      : { bar: "hsl(var(--success))", text: "text-success", bg: "bg-success" };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Başarı Oranı */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs text-muted-foreground mb-1">Başarı Oranı</p>
        <p className={`text-3xl font-bold ${rateColor.text}`}>{successRate}%</p>
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-muted-foreground/70 mb-1">
            <span>Hedef: 80%</span>
            <span>{successRate}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${successRate}%`, backgroundColor: rateColor.bar }}
            />
          </div>
        </div>
      </div>

      {/* Aktif Çalışan */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs text-muted-foreground mb-1">Aktif Çalışan</p>
        <p className="text-3xl font-bold text-primary">{runningRuns}</p>
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground/70">Regresyon</span>
            <span className="font-medium text-muted-foreground">{regressionRunning}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground/70">Özel</span>
            <span className="font-medium text-muted-foreground">{ozelRunning}</span>
          </div>
        </div>
      </div>

      {/* Toplam Run */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs text-muted-foreground mb-1">Toplam Run</p>
        <p className="text-3xl font-bold text-foreground">{total}</p>
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground/70">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                Geçti
              </span>
              <span className="font-medium text-success">{passedRuns}</span>
            </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-muted-foreground/70">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" />
              Başarısız
            </span>
            <span className="font-medium text-destructive">{failedRuns}</span>
          </div>
        </div>
      </div>

      {/* Ort. Hata/Run */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs text-muted-foreground mb-1">Ort. Hata/Run</p>
        <p className="text-3xl font-bold text-foreground">{avgErrorPerRun}</p>
        <div className="mt-3">
          <div
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${
              trend > 0
                ? "bg-destructive/10 text-destructive"
                : trend < 0
                ? "bg-success/10 text-success"
                : "bg-muted/50 text-muted-foreground"
            }`}
          >
            {trend > 0 ? "▲" : trend < 0 ? "▼" : "—"}
            <span>
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)} dünden
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
