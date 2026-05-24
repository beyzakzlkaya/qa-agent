import { NextRequest, NextResponse } from "next/server";
import { jiraGet } from "@/lib/jira-pipeline/api-clients";

export interface JiraTask {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string;
  updated: string;
  url: string;
}

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      priority: { name: string };
      assignee?: { displayName: string } | null;
      updated: string;
    };
  }>;
  total: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "READY FOR QA";
  const projectKey = searchParams.get("project") ?? process.env.JIRA_PROJECT_KEY ?? "NE";

  try {
    const data = await jiraGet<JiraSearchResponse>(
      `/search/jql?jql=${encodeURIComponent(`project = "${projectKey}" AND status = "${status}" ORDER BY updated DESC`)}&fields=summary,status,priority,assignee,updated&maxResults=50`
    );

    const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");

    const tasks: JiraTask[] = (data.issues ?? []).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name ?? "Medium",
      assignee: issue.fields.assignee?.displayName ?? undefined,
      updated: issue.fields.updated,
      url: `${baseUrl}/browse/${issue.key}`,
    }));

    return NextResponse.json({ tasks, total: data.total ?? tasks.length });
  } catch (err) {
    console.error("[api/jira/tasks] Hata:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "JIRA task listesi alınamadı" },
      { status: 500 }
    );
  }
}
