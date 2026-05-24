/**
 * GET /api/jira/risk-summary/[key]
 *
 * LLM ile üretilmiş risk özetini streaming olarak döner.
 * - Aynı task + aynı input için DB'de cache'lenmiş özet varsa direkt onu yollar
 *  (cache hit'te de SSE formatında — client tek yol gereksinim)
 * - Cache yoksa LLM'i çağırır, chunk'ları SSE event'i olarak yollar, sonra DB'ye kaydeder
 *
 * SSE protokol:
 *   data: { "type": "chunk", "text": "..." }
 *   data: { "type": "done",  "fullText": "...", "cached": false }
 *   data: { "type": "error", "message": "..." }
 */

import { NextRequest } from "next/server";
import { fetchJiraTask } from "@/lib/jira-pipeline/jira-fetcher";
import { analyzePRSafe } from "@/lib/jira-pipeline/pr-analyzer";
import { enrichJiraTask } from "@/lib/jira-pipeline/task-enrichment";
import {
  computeRiskSummaryHash,
  streamRiskSummary,
  type RiskSummaryInput,
} from "@/lib/jira-pipeline/risk-summary";
import {
  getCachedRiskSummary,
  saveRiskSummary,
} from "@/lib/db/queries";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params;
  const key = rawKey.trim().toUpperCase();
  if (!TASK_KEY_REGEX.test(key)) {
    return new Response(JSON.stringify({ error: "Geçersiz task numarası" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("fresh") === "1";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sse = (type: string, payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
        );
      };

      try {
        // 1) Task + PR + enrichment'i topla (cache hash için gerekli)
        const taskMeta = await fetchJiraTask(key);
        const [prAnalysis, enrichment] = await Promise.all([
          analyzePRSafe(taskMeta.prUrl),
          enrichJiraTask({ key, updated: new Date().toISOString() }),
        ]);

        const input: RiskSummaryInput = {
          jira: taskMeta,
          pr: prAnalysis,
          reopenCount: enrichment.reopenCount,
          lastReopenReason: null,
          modules: enrichment.modules.map((m) => m.label),
        };

        const hash = computeRiskSummaryHash(input);

        // 2) Cache kontrolü
        if (!force) {
          const cached = getCachedRiskSummary(key, hash);
          if (cached) {
            // Cache hit — tek chunk olarak yolla, "done" event'i ile bitir
            sse("chunk", { text: cached.summary });
            sse("done", { fullText: cached.summary, cached: true });
            controller.close();
            return;
          }
        }

        // 3) LLM'i çağır, chunk'ları akıt
        let fullText = "";
        const onChunk = (chunk: string) => {
          fullText += chunk;
          sse("chunk", { text: chunk });
        };

        try {
          fullText = await streamRiskSummary(input, onChunk);
        } catch (err) {
          sse("error", { message: (err as Error).message ?? "LLM hatası" });
          controller.close();
          return;
        }

        // 4) DB'ye yaz
        if (fullText.trim().length > 0) {
          try {
            saveRiskSummary(key, hash, fullText.trim(), prAnalysis?.prNumber ?? null);
          } catch (err) {
            console.warn(`[risk-summary] cache save failed:`, (err as Error).message);
          }
        }

        sse("done", { fullText: fullText.trim(), cached: false });
        controller.close();
      } catch (err) {
        sse("error", { message: (err as Error).message ?? "Bilinmeyen hata" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
