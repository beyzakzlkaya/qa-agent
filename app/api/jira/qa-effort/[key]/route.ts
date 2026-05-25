/**
 * POST /api/jira/qa-effort/[key]
 *
 * Bir JIRA task için tahmini QA eforunu hesaplar.
 * Akış:
 *   1) JIRA task + PR + enrichment paralel toplanır
 *   2) Test caseler `generateOnlyPipeline` ile üretilir (mevcut LLM pipeline)
 *   3) Toplanan tüm bilgi LLM'e gönderilir, dakika cinsinden tahmin alınır
 *   4) Sonuç DB'de cache'lenir (jira_key + input_hash)
 *
 * Query param: ?fresh=1 → cache atla, yeniden hesapla
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchJiraTask } from "@/lib/jira-pipeline/jira-fetcher";
import { analyzePRSafe } from "@/lib/jira-pipeline/pr-analyzer";
import { enrichJiraTask } from "@/lib/jira-pipeline/task-enrichment";
import { generateOnlyPipeline } from "@/lib/jira-pipeline/jira-runner";
import {
  computeQaEffortHash,
  estimateQaEffort,
  type QaEffortInput,
  type QaEffortResult,
} from "@/lib/jira-pipeline/qa-effort";
import { getCachedQaEffort, saveQaEffort } from "@/lib/db/queries";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

export interface QaEffortResponse extends QaEffortResult {
  cached: boolean;
  generatedAt: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params;
  const key = rawKey.trim().toUpperCase();
  if (!TASK_KEY_REGEX.test(key)) {
    return NextResponse.json({ error: "Geçersiz task numarası" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("fresh") === "1";

  try {
    // 1) Task + PR + enrichment paralel
    const taskMeta = await fetchJiraTask(key);
    const [prAnalysis, enrichment] = await Promise.all([
      analyzePRSafe(taskMeta.prUrl),
      enrichJiraTask({ key, updated: new Date().toISOString() }),
    ]);

    // 2) Test caseleri üret
    const generated = await generateOnlyPipeline({
      taskKey: key,
      environment: "preprod",
    });

    const input: QaEffortInput = {
      jira: taskMeta,
      pr: prAnalysis,
      cases: generated.cases,
      reopenCount: enrichment.reopenCount,
      modules: enrichment.modules.map((m) => m.label),
    };

    const hash = computeQaEffortHash(input);

    // 3) Cache kontrolü
    if (!force) {
      const cached = getCachedQaEffort(key, hash);
      if (cached) {
        const cachedResult = JSON.parse(cached.payload_json) as QaEffortResult;
        const response: QaEffortResponse = {
          ...cachedResult,
          cached: true,
          generatedAt: cached.created_at,
        };
        return NextResponse.json(response);
      }
    }

    // 4) LLM ile tahmin
    const result = await estimateQaEffort(input);

    // 5) DB'ye kaydet
    try {
      saveQaEffort(
        key,
        hash,
        JSON.stringify(result),
        result.caseCount,
        result.totalMinutes
      );
    } catch (err) {
      console.warn(`[qa-effort] cache save failed:`, (err as Error).message);
    }

    const response: QaEffortResponse = {
      ...result,
      cached: false,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error(`[api/jira/qa-effort/${key}]`, err);
    return NextResponse.json(
      { error: (err as Error).message ?? "QA effort tahmin edilemedi" },
      { status: 500 }
    );
  }
}
