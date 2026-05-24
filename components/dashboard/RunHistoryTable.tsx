"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RunStatusBadge } from "./RunStatusBadge";
import type { TestRun } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Play, ExternalLink } from "lucide-react";

const RUN_TYPE_LABELS: Record<string, string> = {
  smoke: "Smoke",
  regression: "Regresyon",
  monkey: "Monkey",
  custom: "Özel",
};

const ENV_LABELS: Record<string, string> = {
  preprod: "Preprod",
  prod: "Prod",
};

function formatDuration(startedAt: string, finishedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RunHistoryTable({ runs }: { runs: TestRun[] }) {
  const router = useRouter();
  const [rerunning, setRerunning] = useState<string | null>(null);

  const handleRerun = async (run: TestRun) => {
    setRerunning(run.id);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${run.name} (Tekrar)`,
          environment: run.environment,
          runType: run.runType,
          triggeredBy: "manual",
        }),
      });
      const data = await res.json();
      if (data.runId) {
        router.push(`/run/${data.runId}`);
      }
    } finally {
      setRerunning(null);
    }
  };

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">Henüz test çalıştırılmamış.</p>
        <p className="text-xs mt-1">
          Test Suite sayfasından bir test başlatın.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left py-2.5 px-4 font-medium">Durum</th>
            <th className="text-left py-2.5 px-4 font-medium">İsim</th>
            <th className="text-left py-2.5 px-4 font-medium">Ortam</th>
            <th className="text-left py-2.5 px-4 font-medium">Tür</th>
            <th className="text-left py-2.5 px-4 font-medium">Sonuç</th>
            <th className="text-left py-2.5 px-4 font-medium">Süre</th>
            <th className="text-left py-2.5 px-4 font-medium">Tarih</th>
            <th className="text-right py-2.5 px-4 font-medium">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-border/50 hover:bg-accent/30 transition-colors group"
            >
              <td className="py-3 px-4">
                <RunStatusBadge status={run.status} />
              </td>
              <td className="py-3 px-4">
                <Link
                  href={
                    run.status === "running"
                      ? `/run/${run.id}`
                      : `/reports/${run.id}`
                  }
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {run.name}
                </Link>
              </td>
              <td className="py-3 px-4">
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border font-medium",
                    run.environment === "prod"
                      ? "bg-warning/10 text-warning border-warning/30"
                      : "bg-primary/10 text-primary border-primary/30"
                  )}
                >
                  {ENV_LABELS[run.environment]}
                </span>
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {RUN_TYPE_LABELS[run.runType] ?? run.runType}
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-success font-medium">
                    {run.passedCases} geçti
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-destructive font-medium">
                    {run.failedCases} kaldı
                  </span>
                  <span className="text-muted-foreground">
                    / {run.totalCases} toplam
                  </span>
                </div>
              </td>
              <td className="py-3 px-4 text-muted-foreground text-xs">
                {formatDuration(run.startedAt, run.finishedAt)}
              </td>
              <td className="py-3 px-4 text-muted-foreground text-xs">
                {formatDate(run.startedAt)}
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={
                      run.status === "running"
                        ? `/run/${run.id}`
                        : `/reports/${run.id}`
                    }
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Detay"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  <button
                    onClick={() => handleRerun(run)}
                    disabled={!!rerunning || run.status === "running"}
                    className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                    title="Tekrar Çalıştır"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
