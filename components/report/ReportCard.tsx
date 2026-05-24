"use client";

import type { CaseResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, ChevronDown, AlertTriangle, Camera } from "lucide-react";
import { StepDescription } from "@/components/shared/StepDescription";
import Image from "next/image";
import { useEffect, useState } from "react";

interface ScreenshotRow {
  id: number;
  test_case_id: string;
  step_index: number | null;
  file_path: string;
  label: string | null;
  taken_at: string;
}

interface Props {
  result: CaseResult;
}

export function ReportCard({ result }: Props) {
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/screenshots?testCaseId=${encodeURIComponent(result.caseId)}`)
      .then((r) => r.json())
      .then((data: { screenshots: ScreenshotRow[] }) => {
        setScreenshots(data.screenshots ?? []);
      })
      .catch(() => {});
  }, [result.caseId]);

  const statusIcon =
    result.status === "success" ? (
      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
    ) : (
      <XCircle className="w-4 h-4 text-destructive shrink-0" />
    );

  const durationLabel = result.durationMs
    ? result.durationMs < 60000
      ? `${(result.durationMs / 1000).toFixed(1)}s`
      : `${Math.floor(result.durationMs / 60000)}m ${Math.floor((result.durationMs % 60000) / 1000)}s`
    : "—";

  return (
    <>
      {expandedImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setExpandedImg(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/screenshot-file?path=${encodeURIComponent(expandedImg)}`}
            alt="Screenshot"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}

      <details className="group border border-border rounded-lg overflow-hidden">
        <summary className="flex items-center gap-3 px-4 py-3 bg-card cursor-pointer list-none hover:bg-accent/30 transition-colors">
          {statusIcon}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">{result.caseId}</span>
            <span className="text-xs text-muted-foreground ml-2">{result.platform}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground">{durationLabel}</span>
            {screenshots.length > 0 && (
              <span className="text-xs bg-blue-500/10 text-blue-500 border border-blue-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Camera className="w-3 h-3" />
                {screenshots.length}
              </span>
            )}
            {result.anomalies.length > 0 && (
              <span className="text-xs bg-warning/10 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full">
                {result.anomalies.length} anomali
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="border-t border-border">
          {/* Steps */}
          {result.steps.length > 0 && (
            <div className="p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Adımlar
                <span className="ml-1.5 text-[10px] bg-muted/60 px-1.5 py-0.5 rounded text-muted-foreground/70 normal-case font-normal tracking-normal">
                  {result.steps.length} adım
                </span>
              </p>
              <div className="space-y-1.5">
                {result.steps.map((step, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2.5 px-3 py-2 rounded-md text-xs",
                      step.status === "success" && "bg-success/5",
                      step.status === "failed" && "bg-destructive/5 border border-destructive/15",
                      step.status === "pending" && "bg-muted/20"
                    )}
                  >
                    {/* Step index badge */}
                    <span
                      className={cn(
                        "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5",
                        step.status === "success"
                          ? "bg-success/15 text-success"
                          : step.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted/40 text-muted-foreground"
                      )}
                    >
                      {step.status === "success" ? "✓" : step.status === "failed" ? "✗" : i + 1}
                    </span>

                    <div className="flex-1 min-w-0">
                      <StepDescription
                        text={step.description}
                        className={cn(
                          "text-foreground/80",
                          step.status === "failed" && "text-destructive"
                        )}
                      />
                    </div>

                    {/* Timestamp + duration */}
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      <span className="text-[9px] text-muted-foreground/50 font-mono whitespace-nowrap">
                        {new Date(step.timestamp).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      {step.durationMs !== undefined && step.durationMs > 0 && (
                        <span className="text-[9px] text-muted-foreground/40 font-mono">
                          {step.durationMs < 1000
                            ? `${step.durationMs}ms`
                            : `${(step.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <div className="px-4 pb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <Camera className="w-3.5 h-3.5" />
                Screenshots
              </p>
              <div className="flex flex-wrap gap-2">
                {screenshots.map((sc) => (
                  <button
                    key={sc.id}
                    onClick={() => setExpandedImg(sc.file_path)}
                    className="relative group/img"
                    title={`Step ${sc.step_index ?? "?"} — ${sc.label ?? "screenshot"}`}
                  >
                    <div className="w-20 h-14 bg-muted/30 border border-border rounded overflow-hidden hover:border-primary transition-colors">
                      <Image
                        src={`/api/screenshot-file?path=${encodeURIComponent(sc.file_path)}`}
                        alt={`Step ${sc.step_index} ${sc.label}`}
                        width={80}
                        height={56}
                        className="object-cover w-full h-full"
                        unoptimized
                      />
                    </div>
                    {sc.label === "fail" && (
                      <span className="absolute top-0.5 right-0.5 bg-destructive text-white text-[9px] px-1 rounded">
                        fail
                      </span>
                    )}
                    <span className="block text-[10px] text-center text-muted-foreground mt-0.5">
                      {sc.label ?? `step ${sc.step_index}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Anomalies */}
          {result.anomalies.length > 0 && (
            <div className="px-4 pb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Anomaliler
              </p>
              <div className="space-y-1.5">
                {result.anomalies.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs bg-warning/5 border border-warning/20 rounded-md p-2"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                    <span className="text-foreground/80">{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {result.errorMessage && (
            <div className="px-4 pb-4">
              <p className="text-xs font-medium text-destructive uppercase tracking-wide mb-2">
                Hata
              </p>
              <pre className="text-xs text-destructive/80 bg-destructive/5 border border-destructive/20 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                {result.errorMessage}
              </pre>
            </div>
          )}
        </div>
      </details>
    </>
  );
}
