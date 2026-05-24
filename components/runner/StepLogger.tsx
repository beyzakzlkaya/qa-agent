"use client";

import { useEffect, useRef } from "react";
import type { TestStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";

interface Props {
  steps: TestStep[];
  activeCase?: string;
}

export function StepLogger({ steps, activeCase }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Adım Logu
        </h3>
        {activeCase && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {activeCase}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
        {steps.length === 0 ? (
          <div className="text-muted-foreground py-4 text-center">
            Bekleniyor...
          </div>
        ) : (
          steps.map((step, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-2 px-2 py-1.5 rounded-md",
              step.status === "running" && "bg-primary/5",
              step.status === "failed" && "bg-destructive/5"
              )}
            >
              <span className="shrink-0 mt-0.5">
                {step.status === "running" ? (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                ) : step.status === "success" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                ) : step.status === "failed" ? (
                  <XCircle className="w-3.5 h-3.5 text-destructive" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </span>
              <span
                className={cn(
                  "flex-1 leading-relaxed break-words",
                  step.status === "failed"
                    ? "text-destructive"
                    : step.status === "running"
                    ? "text-primary"
                    : "text-foreground/80"
                )}
              >
                {step.description}
              </span>
              {step.durationMs !== undefined && (
                <span className="shrink-0 text-muted-foreground text-[10px]">
                  {step.durationMs < 1000
                    ? `${step.durationMs}ms`
                    : `${(step.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
