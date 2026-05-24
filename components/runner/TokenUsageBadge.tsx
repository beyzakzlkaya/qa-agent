"use client";

import { cn } from "@/lib/utils";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface TokenUsageBadgeProps {
  usage: TokenUsage;
  className?: string;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function TokenUsageBadge({ usage, className }: TokenUsageBadgeProps) {
  if (usage.totalTokens === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground/70 select-none",
        className
      )}
      title={`Prompt: ${usage.promptTokens} • Completion: ${usage.completionTokens} • Total: ${usage.totalTokens}`}
    >
      <span className="font-medium text-muted-foreground">
        ∑ {formatTokenCount(usage.totalTokens)} tokens
      </span>
      <span className="flex gap-1.5">
        <span>↑ {formatTokenCount(usage.promptTokens)} prompt</span>
        <span>↓ {formatTokenCount(usage.completionTokens)} completion</span>
      </span>
    </div>
  );
}
