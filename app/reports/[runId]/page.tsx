"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ReportCard } from "@/components/report/ReportCard";
import { RunStatusBadge } from "@/components/dashboard/RunStatusBadge";
import type { TestRun, CaseResult } from "@/lib/types";
import { ArrowLeft, Play, Download, Camera } from "lucide-react";

interface ScreenshotRow {
  id: number;
  run_id: string | null;
  test_case_id: string;
  file_path: string;
  label: string | null;
  taken_at: string;
}

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  const [run, setRun] = useState<TestRun | null>(null);
  const [caseResults, setCaseResults] = useState<CaseResult[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    fetch(`/api/runs/${runId}`)
      .then((r) => r.json())
      .then((d) => {
        setRun(d.run);
        setCaseResults(d.caseResults ?? []);
      })
      .finally(() => setLoading(false));
    fetch(`/api/screenshots?runId=${runId}`)
      .then((r) => r.json())
      .then((d) => setScreenshots(d.screenshots ?? []))
      .catch(() => {});
  }, [runId]);

  const handleRerun = async () => {
    if (!run) return;
    setRerunning(true);
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
      if (data.runId) window.open(`/run/${data.runId}`, "_blank");
    } finally {
      setRerunning(false);
    }
  };

  const handleExportJSON = () => {
    if (!run) return;
    const report = { run, caseResults };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${run.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Run bulunamadı.
      </div>
    );
  }

  const duration = run.finishedAt
    ? Math.round(
        (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
      )
    : null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{run.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <RunStatusBadge status={run.status} />
              <span className="text-xs text-muted-foreground">
                {run.environment} • {new Date(run.startedAt).toLocaleString("tr-TR")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExportJSON}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent text-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            JSON İndir
          </button>
          <button
            onClick={handleRerun}
            disabled={rerunning}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
          >
            {rerunning ? (
              <div className="w-3.5 h-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Tekrar Çalıştır
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Toplam", value: run.totalCases, color: "text-foreground" },
          { label: "Geçti", value: run.passedCases, color: "text-success" },
          { label: "Kaldı", value: run.failedCases, color: "text-destructive" },
          {
            label: "Süre",
            value: duration !== null ? `${duration}s` : "—",
            color: "text-muted-foreground",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-card border border-border rounded-lg p-3"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Case results */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground mb-3">
          Case Sonuçları
        </h3>
        {caseResults.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Sonuç bulunamadı.
          </div>
        ) : (
          caseResults.map((r) => {
            const caseShots = screenshots.filter((s) => s.test_case_id === r.caseId);
            return (
              <div key={r.id}>
                <ReportCard result={r} />
                {caseShots.length > 0 && (
                  <div className="mt-1.5 mb-3 ml-4 p-3 rounded-md border border-border bg-card">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Camera className="w-3 h-3" />
                      Ekran görüntüleri ({caseShots.length})
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {caseShots.map((s) => (
                        <a
                          key={s.id}
                          href={`/api/screenshot-file?path=${encodeURIComponent(s.file_path)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block"
                          title={`${s.label ?? "screenshot"} • ${new Date(s.taken_at + "Z").toLocaleString("tr-TR")}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/screenshot-file?path=${encodeURIComponent(s.file_path)}`}
                            alt={s.label ?? "screenshot"}
                            className={`h-32 rounded border object-cover object-top hover:opacity-90 transition-opacity ${
                              s.label === "fail" ? "border-destructive/50" : "border-border"
                            }`}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
