"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  taskKey: string;
  /** Streaming başlangıcı için trigger — true yapılınca SSE bağlantısı açılır */
  active: boolean;
}

type State =
  | { phase: "idle" }
  | { phase: "streaming"; text: string }
  | { phase: "done"; text: string; cached: boolean }
  | { phase: "error"; message: string };

interface SseEvent {
  type: "chunk" | "done" | "error";
  text?: string;
  fullText?: string;
  cached?: boolean;
  message?: string;
}

export function RiskSummaryPanel({ taskKey, active }: Props) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const start = (fresh = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ phase: "streaming", text: "" });

    (async () => {
      try {
        const res = await fetch(
          `/api/jira/risk-summary/${taskKey}${fresh ? "?fresh=1" : ""}`,
          { signal: ctrl.signal }
        );
        if (!res.ok || !res.body) {
          let message = `HTTP ${res.status}`;
          try {
            const json = (await res.json()) as { error?: string };
            if (json.error) message = json.error;
          } catch {
            // ignore
          }
          setState({ phase: "error", message });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            for (const line of rawEvent.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data) continue;
              let parsed: SseEvent;
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              if (parsed.type === "chunk" && typeof parsed.text === "string") {
                accumulated += parsed.text;
                setState({ phase: "streaming", text: accumulated });
              } else if (parsed.type === "done") {
                setState({
                  phase: "done",
                  text: parsed.fullText ?? accumulated,
                  cached: !!parsed.cached,
                });
                return;
              } else if (parsed.type === "error") {
                setState({ phase: "error", message: parsed.message ?? "Bilinmeyen hata" });
                return;
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({ phase: "error", message: (err as Error).message ?? "Bağlantı hatası" });
      }
    })();
  };

  useEffect(() => {
    if (!active) return;
    start(false);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey, active]);

  return (
    <div className="border border-primary/25 bg-primary/[0.06] rounded-lg p-4 mb-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center mt-0.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="text-sm font-semibold text-foreground">LLM Risk Özeti</h3>
            {state.phase === "streaming" && (
              <span className="inline-flex items-center gap-1 text-[10px] text-primary/80 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                Üretiliyor
              </span>
            )}
            {state.phase === "done" && state.cached && (
              <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                cache&apos;den
              </span>
            )}
            <button
              type="button"
              onClick={() => start(true)}
              disabled={state.phase === "streaming"}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Risk özetini yeniden üret"
            >
              <RefreshCw className={cn("w-3 h-3", state.phase === "streaming" && "animate-spin")} />
              Yenile
            </button>
          </div>

          {state.phase === "idle" && (
            <p className="text-xs text-muted-foreground">
              Risk özeti hazırlanıyor...
            </p>
          )}

          {state.phase === "error" && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p>{state.message}</p>
            </div>
          )}

          {(state.phase === "streaming" || state.phase === "done") && (
            <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
              {state.text || (state.phase === "streaming" ? "..." : "")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
