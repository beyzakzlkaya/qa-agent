/**
 * GET /api/jira/full-context/[key]
 *
 * Detay sayfasında gösterilecek tam JIRA + PR bağlamını döndürür:
 *  - JIRA: özet, description, AC, assignee, status, priority, comments
 *  - PR meta + tüm dosyalar (modül tespiti için)
 *  - Çıkarımsal değerler: modüller, reopen sayısı, READY FOR QA tarihi
 *
 * Bu endpoint sadece veri toplar — LLM risk özeti için /api/jira/risk-summary
 * ayrı çağrılır (streaming).
 */

import { NextRequest, NextResponse } from "next/server";
import { jiraGet } from "@/lib/jira-pipeline/api-clients";
import { fetchJiraTask } from "@/lib/jira-pipeline/jira-fetcher";
import { analyzePRSafe } from "@/lib/jira-pipeline/pr-analyzer";
import { enrichJiraTask, type JiraTaskEnrichment } from "@/lib/jira-pipeline/task-enrichment";
import type { JiraTaskMeta, PrAnalysis } from "@/lib/types";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

export interface FullTaskContext {
  key: string;
  url: string;
  jira: JiraTaskMeta & {
    status: string;
    priority: string;
    assignee?: string;
  };
  pr: PrAnalysis | null;
  enrichment: JiraTaskEnrichment;
}

interface JiraIssueStatus {
  fields: {
    status?: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string } | null;
    updated?: string;
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params;
  const key = rawKey.trim().toUpperCase();
  if (!TASK_KEY_REGEX.test(key)) {
    return NextResponse.json({ error: "Geçersiz task numarası" }, { status: 400 });
  }

  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");

  try {
    // 4 paralel istek — task meta (description/AC/PR url), status, enrichment, PR analizi sırayla
    const [taskMeta, statusInfo] = await Promise.all([
      fetchJiraTask(key),
      jiraGet<JiraIssueStatus>(`/issue/${key}?fields=status,priority,assignee,updated`),
    ]);

    const updated = statusInfo.fields.updated ?? new Date().toISOString();

    const [enrichment, prAnalysis] = await Promise.all([
      enrichJiraTask({ key, updated }),
      analyzePRSafe(taskMeta.prUrl),
    ]);

    const fullContext: FullTaskContext = {
      key,
      url: `${baseUrl}/browse/${key}`,
      jira: {
        ...taskMeta,
        status: statusInfo.fields.status?.name ?? "Unknown",
        priority: statusInfo.fields.priority?.name ?? "Medium",
        assignee: statusInfo.fields.assignee?.displayName ?? undefined,
      },
      pr: prAnalysis,
      enrichment,
    };

    return NextResponse.json(fullContext);
  } catch (err) {
    console.error(`[api/jira/full-context/${key}]`, err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Task bağlamı alınamadı" },
      { status: 500 }
    );
  }
}
