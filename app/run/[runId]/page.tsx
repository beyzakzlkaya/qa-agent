"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RunStatusBadge } from "@/components/dashboard/RunStatusBadge";
import { StepDescription } from "@/components/shared/StepDescription";
import type { TestRun, CaseResult, TestStep, Anomaly, WsMessage } from "@/lib/types";
import { ArrowLeft, Square, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Step icons ────────────────────────────────────────────────────────────────

// ─── Single step row ───────────────────────────────────────────────────────────
function StepRow({ step, index }: { step: TestStep; index: number; isLast: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-3 py-2 rounded-md text-xs transition-all",
        step.status === "running" && "bg-primary/10 ring-1 ring-primary/30",
        step.status === "failed" && "bg-destructive/5 border border-destructive/15",
        step.status === "success" && "bg-success/3"
      )}
    >
      {/* Index badge */}
      <span
        className={cn(
          "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5",
          step.status === "running"
            ? "bg-primary/15 text-primary"
            : step.status === "failed"
            ? "bg-destructive/15 text-destructive"
            : "bg-success/15 text-success"
        )}
      >
        {step.status === "running" ? (
          <span className="block w-2.5 h-2.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        ) : step.status === "failed" ? (
          "✗"
        ) : (
          "✓"
        )}
      </span>

      <div className="flex-1 min-w-0">
        <StepDescription
          text={step.description}
          className={cn(
            step.status === "failed" ? "text-destructive" : "text-foreground/85",
            step.status === "running" && "text-primary/80"
          )}
        />
        {step.durationMs !== undefined && step.durationMs > 0 && (
          <span className="text-muted-foreground/40 text-[10px] mt-0.5 block font-mono">
            {step.durationMs < 1000
              ? `${step.durationMs}ms`
              : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-0.5 mt-0.5">
        <span className="text-muted-foreground/40 text-[10px] font-mono whitespace-nowrap">
          {new Date(step.timestamp).toLocaleTimeString("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        <span className="text-muted-foreground/25 text-[9px] font-mono">#{index + 1}</span>
      </div>
    </div>
  );
}

// ─── Step Log ─────────────────────────────────────────────────────────────────
function StepLog({ steps, activeTitle, isRunning }: { steps: TestStep[]; activeTitle?: string; isRunning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  // Son running veya son adım özeti
  const lastStep = steps[steps.length - 1];
  const currentAction = isRunning && lastStep
    ? lastStep.description.split("\n")[0].slice(0, 120)
    : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Adım Logu
          </span>
          {steps.length > 0 && (
            <span className="text-[10px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded">
              {steps.length}
            </span>
          )}
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] text-primary">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Canlı
            </span>
          )}
        </div>
        {activeTitle && (
          <span className="text-xs text-primary/80 truncate max-w-[260px]">{activeTitle}</span>
        )}
      </div>

      {/* Mevcut eylem banner */}
      {currentAction && (
        <div className="px-4 py-2 bg-primary/5 border-b border-primary/15 shrink-0">
          <p className="text-[11px] text-primary/60 font-mono truncate">
            <span className="text-primary/40 mr-1.5">▶</span>
            {currentAction}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <div className="w-5 h-5 rounded-full border-2 border-muted border-t-muted-foreground animate-spin" />
            <span className="text-xs">Görev başlatılıyor...</span>
          </div>
        ) : (
          steps.map((step, i) => (
            <StepRow key={i} step={step} index={i} isLast={i === steps.length - 1} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Anomaly badge ─────────────────────────────────────────────────────────────
function AnomalyBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-warning/10 text-warning border border-warning/20">
      <AlertTriangle className="w-3 h-3" />
      {count} anomali
    </div>
  );
}

// ─── Case status list ──────────────────────────────────────────────────────────
function CaseList({ results }: { results: CaseResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="px-3 py-2 space-y-1 border-t border-border">
      {results.map((r) => (
        <div key={r.id} className="flex items-center gap-1.5 text-[11px]">
          <span
            className={
              r.status === "success"
                ? "text-success"
                : r.status === "failed"
                ? "text-destructive"
                : "text-primary"
            }
          >
            {r.status === "success" ? "✓" : r.status === "failed" ? "✗" : "⟳"}
          </span>
          <span className="text-muted-foreground truncate flex-1">{r.caseId}</span>
          <span className="text-muted-foreground/60 uppercase shrink-0">{r.platform}</span>
          {r.durationMs !== undefined && (
            <span className="text-muted-foreground/50 shrink-0">
              {r.durationMs < 60_000
                ? `${(r.durationMs / 1000).toFixed(1)}s`
                : `${Math.round(r.durationMs / 60_000)}m`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
interface LiveState {
  run: TestRun | null;
  caseResults: CaseResult[];
  liveSteps: TestStep[];
  liveAnomalies: Anomaly[];
  activeCaseTitle?: string;
}

export default function RunPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  const wsRef = useRef<WebSocket | null>(null);

  const [state, setState] = useState<LiveState>({
    run: null,
    caseResults: [],
    liveSteps: [],
    liveAnomalies: [],
  });
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [, forceRender] = useState(0);

  // Initial snapshot from DB — called once on mount and once after run finishes
  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        run: data.run,
        caseResults: data.caseResults ?? [],
        // After run completes, WS buffer already gave us all steps — keep them
        liveSteps: prev.liveSteps,
      }));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    // One-time initial load so the page shows something before WS connects
    fetchRun();

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws?runId=${runId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 2_000);
        }
      };

      ws.onmessage = (event) => {
        let msg: WsMessage;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === "step_update") {
          const { step } = msg.payload as { caseResultId: string; step: TestStep };
          setState((prev) => {
            const existingIdx = prev.liveSteps.findIndex(
              (s) => s.index === step.index && s.timestamp === step.timestamp
            );
            if (existingIdx !== -1) {
              // Step exists — update it in place (e.g. status: "running" → "success")
              const updated = [...prev.liveSteps];
              updated[existingIdx] = step;
              return { ...prev, liveSteps: updated };
            }
            return { ...prev, liveSteps: [...prev.liveSteps, step] };
          });
        } else if (msg.type === "case_start") {
          const p = msg.payload as { caseResultId: string; caseId: string; title: string; platform: string };
          setState((prev) => ({
            ...prev,
            activeCaseTitle: p.title,
            // Register a running CaseResult entry so CaseList shows it immediately
            caseResults: prev.caseResults.some((r) => r.id === p.caseResultId)
              ? prev.caseResults
              : [
                  ...prev.caseResults,
                  {
                    id: p.caseResultId,
                    runId,
                    caseId: p.caseId,
                    platform: p.platform as CaseResult["platform"],
                    status: "running" as const,
                    steps: [],
                    anomalies: [],
                    executedAt: new Date().toISOString(),
                  },
                ],
          }));
        } else if (msg.type === "case_end") {
          const p = msg.payload as {
            caseResultId: string;
            caseId: string;
            status: CaseResult["status"];
            durationMs?: number;
            steps: TestStep[];
            anomalies: Anomaly[];
          };
          setState((prev) => ({
            ...prev,
            caseResults: prev.caseResults.map((r) =>
              r.id === p.caseResultId
                ? { ...r, status: p.status, durationMs: p.durationMs, steps: p.steps, anomalies: p.anomalies }
                : r
            ),
            liveSteps: [],
            activeCaseTitle: undefined,
          }));
        } else if (msg.type === "anomaly") {
          const { anomaly } = msg.payload as { anomaly: Anomaly };
          setState((prev) => {
            const exists = prev.liveAnomalies.some(
              (a) => a.type === anomaly.type && a.timestamp === anomaly.timestamp
            );
            if (exists) return prev;
            return { ...prev, liveAnomalies: [...prev.liveAnomalies, anomaly] };
          });
        } else if (msg.type === "run_end") {
          const p = msg.payload as { status: TestRun["status"]; passed: number; failed: number };
          // Mark run as finished immediately from WS payload for instant UI feedback,
          // then fetch the DB snapshot (now fully written) for accurate final state.
          setState((prev) => ({
            ...prev,
            run: prev.run
              ? { ...prev.run, status: p.status, passedCases: p.passed, failedCases: p.failed, finishedAt: new Date().toISOString() }
              : prev.run,
          }));
          fetchRun();
          destroyed = true;
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
          ws?.close();
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close();
    };
  }, [runId, fetchRun]);

  // Completed steps live inside caseResults (moved there on case_end),
  // liveSteps holds the currently-running case's steps from WS.
  const completedSteps: TestStep[] = state.caseResults
    .filter((r) => r.status !== "running")
    .flatMap((r) => r.steps ?? []);

  const allSteps: TestStep[] = [...completedSteps, ...state.liveSteps];

  const allAnomalies: Anomaly[] = [
    ...state.caseResults.flatMap((r) => r.anomalies ?? []),
    ...state.liveAnomalies,
  ];

  const passedCount = state.caseResults.filter((r) => r.status === "success").length;
  const failedCount = state.caseResults.filter((r) => r.status === "failed").length;
  const totalCount = state.run?.totalCases ?? 0;
  const isRunning = state.run?.status === "running";

  // Tick every second to keep elapsed timer live while running
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => forceRender((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, [isRunning]);

  const elapsedLabel = (() => {
    if (!state.run?.startedAt) return null;
    const ms = Date.now() - new Date(state.run.startedAt).getTime();
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  })();

  const stopRun = async () => {
    await fetch(`/api/runs/${runId}/stop`, { method: "POST" }).catch(() => {});
  };

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {state.run?.name ?? "Yükleniyor..."}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {state.run && <RunStatusBadge status={state.run.status} />}
              <span className="text-xs text-muted-foreground">
                {state.run?.environment}
                {totalCount > 0 && ` • ${passedCount + failedCount}/${totalCount} tamamlandı`}
                {elapsedLabel && ` • ${elapsedLabel}`}
              </span>
              <AnomalyBadge count={allAnomalies.length} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* WS bağlantı göstergesi */}
          <span
            className={cn(
              "flex items-center gap-1 text-[10px]",
              wsConnected ? "text-success/70" : "text-muted-foreground/40"
            )}
            title={wsConnected ? "WebSocket bağlı" : "WebSocket bağlı değil"}
          >
            {wsConnected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
          </span>

          {isRunning && (
            <button
              onClick={stopRun}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Durdur
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="h-0.5 bg-muted shrink-0">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${((passedCount + failedCount) / totalCount) * 100}%` }}
          />
        </div>
      )}

      {/* Step log — tam genişlik */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <StepLog steps={allSteps} activeTitle={state.activeCaseTitle} isRunning={isRunning} />
        )}
      </div>

      {/* Case list — sadece birden fazla case varsa göster */}
      {state.caseResults.length > 0 && (
        <CaseList results={state.caseResults} />
      )}
    </div>
  );
}
