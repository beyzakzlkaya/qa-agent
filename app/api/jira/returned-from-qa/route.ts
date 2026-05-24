import { NextRequest, NextResponse } from "next/server";
import { jiraGet } from "@/lib/jira-pipeline/api-clients";

export interface ReturnedIssue {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  url: string;
  returnCount: number;
  lastReturnAt?: string;
  lastReason?: string;
  reasons: string[];
}

export interface ReturnedFromQaResp {
  issues: ReturnedIssue[];
  total: number;
  available: boolean;
  projectKey: string;
}

interface JiraChangelogItem {
  field: string;
  fromString?: string;
  toString?: string;
}

interface JiraHistory {
  created: string;
  items: JiraChangelogItem[];
}

interface JiraCommentBody {
  body?: { content?: Array<{ content?: Array<{ text?: string }> }> } | string;
  created?: string;
}

interface JiraIssueDetail {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee?: { displayName: string } | null;
    comment?: { comments?: JiraCommentBody[] };
  };
  changelog?: { histories: JiraHistory[] };
}

interface JiraSearchResp {
  issues?: Array<{ key: string }>;
  total?: number;
  nextPageToken?: string;
  isLast?: boolean;
}

function extractCommentText(c: JiraCommentBody): string {
  const b = c.body;
  if (!b) return "";
  if (typeof b === "string") return b;
  const blocks = b.content ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    for (const inline of block.content ?? []) {
      if (inline.text) parts.push(inline.text);
    }
  }
  return parts.join(" ").trim();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectKey = searchParams.get("project") ?? process.env.JIRA_PROJECT_KEY ?? "NE";
  const limit = parseInt(searchParams.get("limit") ?? "200");
  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");

  if (!baseUrl || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    return NextResponse.json({
      issues: [],
      total: 0,
      available: false,
      projectKey,
    } as ReturnedFromQaResp);
  }

  try {
    // Step 1 — list candidate issues (active sprints only), paginated until isLast
    const candidatesJql = `project = "${projectKey}" AND sprint in openSprints() AND status changed FROM "IN QA" TO "In Progress" ORDER BY updated DESC`;
    const keys: string[] = [];
    let nextPageToken: string | undefined;
    const pageSize = 100;
    while (keys.length < limit) {
      const remaining = limit - keys.length;
      const pageMax = Math.min(pageSize, remaining);
      const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const page = await jiraGet<JiraSearchResp>(
        `/search/jql?jql=${encodeURIComponent(candidatesJql)}&fields=summary&maxResults=${pageMax}${tokenParam}`
      );
      for (const i of page.issues ?? []) keys.push(i.key);
      if (page.isLast || !page.nextPageToken) break;
      nextPageToken = page.nextPageToken;
    }

    // Step 2 — for each issue, fetch changelog + recent comments and tally return events
    const detailed = await Promise.all(
      keys.map(async (key) => {
        try {
          const issue = await jiraGet<JiraIssueDetail>(
            `/issue/${key}?expand=changelog&fields=summary,status,assignee,comment`
          );

          const returns: { created: string; reason?: string }[] = [];
          for (const h of issue.changelog?.histories ?? []) {
            for (const item of h.items) {
              if (
                item.field === "status" &&
                (item.fromString ?? "").toUpperCase() === "IN QA" &&
                (item.toString ?? "").toUpperCase() === "IN PROGRESS"
              ) {
                returns.push({ created: h.created });
              }
            }
          }

          // Reason heuristic: closest comment posted within 1 hour after each return event
          const comments = issue.fields.comment?.comments ?? [];
          const commentTimes = comments
            .map((c) => ({
              ts: c.created ? Date.parse(c.created) : NaN,
              text: extractCommentText(c),
            }))
            .filter((c) => Number.isFinite(c.ts));

          const reasons: string[] = [];
          for (const r of returns) {
            const ts = Date.parse(r.created);
            if (!Number.isFinite(ts)) continue;
            // pick the comment closest after the transition, within 24h window
            const after = commentTimes
              .filter((c) => c.ts >= ts && c.ts - ts < 24 * 60 * 60 * 1000)
              .sort((a, b) => a.ts - b.ts)[0];
            if (after?.text) {
              const snippet = after.text.length > 240 ? after.text.slice(0, 237) + "…" : after.text;
              reasons.push(snippet);
              r.reason = snippet;
            }
          }

          returns.sort((a, b) => b.created.localeCompare(a.created));

          const result: ReturnedIssue = {
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            assignee: issue.fields.assignee?.displayName ?? undefined,
            url: `${baseUrl}/browse/${issue.key}`,
            returnCount: returns.length,
            lastReturnAt: returns[0]?.created,
            lastReason: returns[0]?.reason,
            reasons,
          };
          return result;
        } catch (err) {
          console.warn(`[returned-from-qa] ${key}:`, (err as Error).message);
          return null;
        }
      })
    );

    const issues = detailed
      .filter((x): x is ReturnedIssue => x !== null)
      .sort((a, b) => b.returnCount - a.returnCount);

    return NextResponse.json({
      issues,
      total: issues.length,
      available: true,
      projectKey,
    } as ReturnedFromQaResp);
  } catch (err) {
    console.error("[api/jira/returned-from-qa]", err);
    return NextResponse.json({
      issues: [],
      total: 0,
      available: false,
      projectKey,
      error: (err as Error).message,
    } as ReturnedFromQaResp & { error: string });
  }
}
