"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Brain, Target, BookOpen, ArrowRight } from "lucide-react";

// ─── LLM Chain-of-Thought Card ────────────────────────────────────────────────

interface CoTData {
  evaluation_previous_goal?: string;
  memory?: string;
  next_goal?: string;
  [key: string]: unknown;
}

const COT_KEYS = ["evaluation_previous_goal", "memory", "next_goal"] as const;

const COT_META: Record<
  (typeof COT_KEYS)[number],
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  evaluation_previous_goal: {
    label: "Önceki Hedef Değerlendirmesi",
    icon: <Target className="w-3 h-3" />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/20",
  },
  memory: {
    label: "Hafıza",
    icon: <BookOpen className="w-3 h-3" />,
    color: "text-sky-400",
    bg: "bg-sky-500/8",
    border: "border-sky-500/20",
  },
  next_goal: {
    label: "Sonraki Hedef",
    icon: <ArrowRight className="w-3 h-3" />,
    color: "text-violet-400",
    bg: "bg-violet-500/8",
    border: "border-violet-500/20",
  },
};

function CoTCard({ parsed }: { parsed: CoTData }) {
  const [open, setOpen] = useState(false);
  const hasKnown = COT_KEYS.some((k) => parsed[k]);
  const extraKeys = Object.keys(parsed).filter(
    (k) => !(COT_KEYS as readonly string[]).includes(k)
  );

  // Preview from next_goal or memory
  const previewText =
    (parsed.next_goal as string | undefined) ??
    (parsed.memory as string | undefined) ??
    Object.values(parsed).find((v) => typeof v === "string") as string | undefined;

  const preview = previewText
    ? previewText.slice(0, 100) + (previewText.length > 100 ? "…" : "")
    : null;

  return (
    <div className="mt-1.5 rounded-lg border border-border/50 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
      >
        <Brain className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider shrink-0">
          Agent Düşüncesi
        </span>
        {!open && preview && (
          <span className="text-[10px] text-muted-foreground truncate flex-1 ml-1 font-normal">
            {preview}
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ml-auto",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {hasKnown &&
            COT_KEYS.map((key) => {
              const val = parsed[key];
              if (!val) return null;
              const meta = COT_META[key];
              return (
                <div key={key} className={cn("px-3 py-2.5", meta.bg)}>
                  <div className={cn("flex items-center gap-1.5 mb-1.5", meta.color)}>
                    {meta.icon}
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words font-sans">
                    {String(val)}
                  </p>
                </div>
              );
            })}

          {/* Extra / unknown keys */}
          {extraKeys.length > 0 && (
            <div className="px-3 py-2">
              {extraKeys.map((k) => (
                <div key={k} className="mb-1.5 last:mb-0">
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider block mb-0.5">
                    {k.replace(/_/g, " ")}
                  </span>
                  <span className="text-[11px] text-foreground/75 whitespace-pre-wrap break-words font-sans">
                    {typeof parsed[k] === "string"
                      ? String(parsed[k])
                      : JSON.stringify(parsed[k], null, 2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function extractJsonFromBlock(text: string): Record<string, unknown> | null {
  // Match ```json ... ``` or ``` ... ```
  const match = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (match) {
    return tryParseJson(match[1]);
  }
  // Direct JSON object
  const stripped = text.trim();
  if (stripped.startsWith("{")) {
    return tryParseJson(stripped);
  }
  return null;
}

// ─── Main exported component ──────────────────────────────────────────────────

interface Props {
  text: string;
  className?: string;
}

export function StepDescription({ text, className }: Props) {
  const lines = text.split("\n");
  const parts: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Markdown code fence — collect until closing ```
    if (line.trim().startsWith("```")) {
      const blockLines: string[] = [line];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        blockLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        blockLines.push(lines[i]); // closing ```
      }
      i++;

      const blockText = blockLines.join("\n");
      const parsed = extractJsonFromBlock(blockText);
      if (parsed) {
        parts.push(<CoTCard key={parts.length} parsed={parsed as CoTData} />);
      } else {
        parts.push(
          <pre
            key={parts.length}
            className="text-[11px] font-mono whitespace-pre-wrap break-words opacity-70 bg-muted/30 rounded p-2 mt-1"
          >
            {blockText}
          </pre>
        );
      }
      continue;
    }

    // Plain JSON object on its own line
    if (line.trim().startsWith("{")) {
      const parsed = tryParseJson(line.trim());
      if (parsed) {
        parts.push(<CoTCard key={parts.length} parsed={parsed as CoTData} />);
        i++;
        continue;
      }
    }

    // Regular text line
    if (line.trim()) {
      parts.push(
        <span
          key={parts.length}
          className={cn(
            "block leading-relaxed whitespace-pre-wrap break-words",
            className
          )}
        >
          {line}
        </span>
      );
    }
    i++;
  }

  if (parts.length === 0) {
    return (
      <span
        className={cn(
          "block leading-relaxed whitespace-pre-wrap break-words",
          className
        )}
      >
        {text}
      </span>
    );
  }

  return <div className="space-y-0.5">{parts}</div>;
}
