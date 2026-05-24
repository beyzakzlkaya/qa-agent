/**
 * GET /api/jira/task-enrichment/[key]
 *
 * Tek bir READY FOR QA task'ı için PR/dosya/modül/badge verisi.
 * Liste sayfasındaki kartlar görünür olunca arka planda (lazy) çağırır;
 * dönüş sonucu kartlara enjekte edilir.
 *
 * Cache: 60sn process-içi cache (aynı task'a kısa süreli tekrar çağrılarda
 * JIRA/GitHub'a yeniden gitme).
 */

import { NextRequest, NextResponse } from "next/server";
import { enrichJiraTask, type JiraTaskEnrichment } from "@/lib/jira-pipeline/task-enrichment";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;
const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  value: JiraTaskEnrichment;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(key: string): JiraTaskEnrichment | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: JiraTaskEnrichment): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params;
  const key = rawKey.trim().toUpperCase();
  if (!TASK_KEY_REGEX.test(key)) {
    return NextResponse.json({ error: "Geçersiz task numarası" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const updatedHint = searchParams.get("updated") ?? new Date().toISOString();
  const forceFresh = searchParams.get("fresh") === "1";

  if (!forceFresh) {
    const cached = getCached(key);
    if (cached) {
      return NextResponse.json({ enrichment: cached, cached: true });
    }
  }

  try {
    const enrichment = await enrichJiraTask({ key, updated: updatedHint });
    setCached(key, enrichment);
    return NextResponse.json({ enrichment, cached: false });
  } catch (err) {
    console.error(`[api/jira/task-enrichment/${key}]`, err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Zenginleştirme alınamadı" },
      { status: 500 }
    );
  }
}
