/**
 * GET /api/jira/pipeline-overview
 *
 * JIRA Pipeline liste sayfasının üstünde gösterilen 5 sayaçlı durum şeridini
 * besler:
 *  - Hazır       (READY FOR QA)
 *  - Üretimde    (LLM ile test case üretiliyor — yerel DB)
 *  - Test ediliyor (IN QA, page-agent çalışıyor)
 *  - Takılı     (READY FOR QA + son N saatte güncellenmemiş)
 *  - Bugün RTR  (status değişikliği RTR'a, bugün)
 *
 * "Üretimde" ve "Test ediliyor" yerel runs tablosundan gelir (henüz JIRA'ya
 * yansımamış olabilir). Diğerleri JIRA'dan.
 */

import { NextRequest, NextResponse } from "next/server";
import { jiraGet, jiraPost } from "@/lib/jira-pipeline/api-clients";
import { listRuns } from "@/lib/db/queries";

export interface PipelineOverviewCounter {
  key: "ready" | "generating" | "inQa" | "stuck" | "rtrToday";
  label: string;
  count: number;
  tone: "default" | "warning" | "success" | "info";
  /** İlgili JIRA filter URL'i (varsa) — kullanıcı tıklarsa JIRA'da açar */
  jiraUrl?: string;
}

export interface PipelineOverviewResp {
  counters: PipelineOverviewCounter[];
  projectKey: string;
  available: boolean;
}

const STUCK_THRESHOLD_HOURS = 24;

async function countByJql(jql: string): Promise<number> {
  try {
    const res = await jiraPost<{ count?: number }>("/search/approximate-count", { jql });
    return typeof res.count === "number" ? res.count : 0;
  } catch {
    return 0;
  }
}

async function countStuck(projectKey: string): Promise<number> {
  // READY FOR QA'de eşik üzerinde bekleyen task sayısı.
  // approximate-count "updated" kriterini desteklemediğinden tam search yapıyoruz.
  try {
    const jql = `project = "${projectKey}" AND status = "READY FOR QA" AND updated < -${STUCK_THRESHOLD_HOURS}h`;
    const data = await jiraGet<{ total?: number; issues?: unknown[] }>(
      `/search/jql?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=0`
    );
    return data.total ?? (Array.isArray(data.issues) ? data.issues.length : 0);
  } catch {
    return 0;
  }
}

async function countRtrToday(projectKey: string): Promise<number> {
  try {
    const jql = `project = "${projectKey}" AND status changed TO "RTR" AFTER startOfDay()`;
    return await countByJql(jql);
  } catch {
    return 0;
  }
}

function countLocalRunsByStatus(): { generating: number; inQa: number } {
  // Yerel runs tablosundan canlı durum.
  // "generating" — son 5 dakika içinde başlamış ve totalCases=0 olan runlar
  // "inQa" — status='running' olan tüm runlar
  try {
    const recent = listRuns(50, 0);
    const now = Date.now();
    let generating = 0;
    let inQa = 0;
    for (const r of recent) {
      if (r.status === "running") {
        const startedMs = Date.parse(r.startedAt);
        const isFresh = Number.isFinite(startedMs) && (now - startedMs) < 5 * 60 * 1000;
        if (r.totalCases === 0 && isFresh) generating += 1;
        else inQa += 1;
      }
    }
    return { generating, inQa };
  } catch {
    return { generating: 0, inQa: 0 };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectKey = searchParams.get("project") ?? process.env.JIRA_PROJECT_KEY ?? "NE";
  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");

  if (!baseUrl || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    return NextResponse.json({
      counters: [],
      projectKey,
      available: false,
    } as PipelineOverviewResp);
  }

  const readyJql = `project = "${projectKey}" AND status = "READY FOR QA"`;
  const inQaJql = `project = "${projectKey}" AND status = "IN QA"`;
  const stuckJql = `project = "${projectKey}" AND status = "READY FOR QA" AND updated < -${STUCK_THRESHOLD_HOURS}h`;
  const rtrTodayJql = `project = "${projectKey}" AND status changed TO "RTR" AFTER startOfDay()`;

  const [readyCount, inQaJiraCount, stuckCount, rtrToday] = await Promise.all([
    countByJql(readyJql),
    countByJql(inQaJql),
    countStuck(projectKey),
    countRtrToday(projectKey),
  ]);

  const local = countLocalRunsByStatus();

  // "Test ediliyor" — yerel runlardan (canlı) + JIRA IN QA arasındaki büyüğü al
  // (yerel run henüz JIRA'ya yansımış olabilir veya olmayabilir; max kullanmak güvenli)
  const inQaCount = Math.max(local.inQa, inQaJiraCount);

  const buildUrl = (jql: string) => `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`;

  const counters: PipelineOverviewCounter[] = [
    { key: "ready",      label: "Hazır",          count: readyCount,         tone: "info",    jiraUrl: buildUrl(readyJql) },
    { key: "generating", label: "Üretimde",       count: local.generating,   tone: "default" },
    { key: "inQa",       label: "Test ediliyor",  count: inQaCount,          tone: "default", jiraUrl: buildUrl(inQaJql) },
    { key: "stuck",      label: "Takılı",         count: stuckCount,         tone: "warning", jiraUrl: buildUrl(stuckJql) },
    { key: "rtrToday",   label: "Bugün RTR",      count: rtrToday,           tone: "success", jiraUrl: buildUrl(rtrTodayJql) },
  ];

  return NextResponse.json({ counters, projectKey, available: true } as PipelineOverviewResp);
}
