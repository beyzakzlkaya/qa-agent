"use client";

import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FullTaskContext } from "@/app/api/jira/full-context/[key]/route";

interface Props {
  ctx: FullTaskContext;
}

/** Description'dan AC maddelerini ayırır (basit heuristic) */
function extractAcceptanceItems(ac: string | undefined): string[] {
  if (!ac) return [];
  const lines = ac.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, "");
    if (cleaned.length > 5 && cleaned.length < 240) items.push(cleaned);
  }
  return items.slice(0, 10);
}

export function TaskContextPanel({ ctx }: Props) {
  const [descExpanded, setDescExpanded] = useState(false);
  const acItems = extractAcceptanceItems(ctx.jira.acceptanceCriteria);
  const description = ctx.jira.description ?? "";
  const shortDesc = description.length > 240 ? description.slice(0, 240) + "…" : description;

  return (
    <div className="border border-border bg-card rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Task Bağlamı</h3>
        <a
          href={ctx.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          JIRA&apos;da aç
        </a>
      </div>

      {/* Description */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          Açıklama
        </p>
        {description ? (
          <>
            <p className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">
              {descExpanded ? description : shortDesc}
            </p>
            {description.length > 240 && (
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
              >
                {descExpanded ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    Daha az göster
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    Tamamını göster
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground italic">Açıklama yok.</p>
        )}
      </div>

      {/* Acceptance criteria */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          Kabul Kriterleri ({acItems.length})
        </p>
        {acItems.length > 0 ? (
          <ul className="space-y-1.5">
            {acItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground/85 leading-relaxed">
                <span className={cn(
                  "shrink-0 w-3.5 h-3.5 rounded border-2 border-border bg-background mt-0.5"
                )} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            JIRA&apos;da formel kabul kriteri bulunamadı.
          </p>
        )}
      </div>
    </div>
  );
}
