import { NextRequest, NextResponse } from "next/server";
import { jiraGet } from "@/lib/jira-pipeline/api-clients";

export interface JiraBugStats {
  openP0: number;
  openP1: number;
  openTickets: number;
  inProgress: number;
  waiting: number;
  weeklyOpened: number;
  weeklyClosed: number;
  weeklyRegression: number;
  mttrHours: number | null;
  projectKey: string;
  available: boolean;
  /** External JIRA URL filtered to open Highest+High bugs */
  criticalBugsUrl?: string;
  /** External JIRA URL filtered to open Highest bugs only */
  highestBugsUrl?: string;
  /** External JIRA URL filtered to open High bugs only */
  highBugsUrl?: string;
}

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    issuetype?: { name: string };
    status?: { name: string; statusCategory?: { key?: string } };
    priority?: { name: string };
    created?: string;
    resolutiondate?: string | null;
    labels?: string[];
  };
}

interface JiraSearchResp {
  issues?: JiraIssue[];
  total?: number;
}

async function safeSearch(jql: string, fields = "summary,status,priority,issuetype"): Promise<JiraIssue[]> {
  try {
    const res = await jiraGet<JiraSearchResp>(
      `/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100`
    );
    return res.issues ?? [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectKey = searchParams.get("project") ?? process.env.JIRA_PROJECT_KEY ?? "NE";
  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
  const buildFilterUrl = (jql: string) =>
    baseUrl ? `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}` : undefined;

  // Quick availability check — if creds are missing, return empty stats
  if (!process.env.JIRA_BASE_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    const empty: JiraBugStats = {
      openP0: 0, openP1: 0, openTickets: 0, inProgress: 0, waiting: 0,
      weeklyOpened: 0, weeklyClosed: 0, weeklyRegression: 0,
      mttrHours: null, projectKey, available: false,
    };
    return NextResponse.json(empty);
  }

  try {
    const bugType = `issuetype = Bug`;
    const projectClause = `project = "${projectKey}"`;
    const notDone = `statusCategory != Done`;
    // Card: bugs that are active in current sprint AND not yet resolved
    const activeFilter = `sprint in openSprints() AND ${notDone}`;
    const inProgressClause = `statusCategory = "In Progress"`;
    const waitingClause = `status in ("Waiting", "Blocked", "Hold", "On Hold", "Waiting for customer", "Waiting for support")`;

    const [openP0, openP1, openAll, inProg, waiting, weeklyOpened, weeklyClosed, weeklyRegression, recentResolved] =
      await Promise.all([
        safeSearch(`${projectClause} AND ${bugType} AND ${activeFilter} AND priority = "Highest"`),
        safeSearch(`${projectClause} AND ${bugType} AND ${activeFilter} AND priority = "High"`),
        safeSearch(`${projectClause} AND ${bugType} AND ${notDone}`),
        safeSearch(`${projectClause} AND ${bugType} AND ${inProgressClause}`),
        safeSearch(`${projectClause} AND ${bugType} AND (${waitingClause})`),
        safeSearch(`${projectClause} AND ${bugType} AND created >= -7d`),
        safeSearch(`${projectClause} AND ${bugType} AND resolved >= -7d`),
        safeSearch(`${projectClause} AND ${bugType} AND created >= -7d AND (labels in (regression, "Regression") OR text ~ "regression")`),
        safeSearch(
          `${projectClause} AND ${bugType} AND resolved >= -30d AND resolutiondate is not EMPTY`,
          "created,resolutiondate"
        ),
      ]);

    let mttrHours: number | null = null;
    if (recentResolved.length > 0) {
      const deltas: number[] = [];
      for (const issue of recentResolved) {
        const created = issue.fields.created ? Date.parse(issue.fields.created) : NaN;
        const resolved = issue.fields.resolutiondate ? Date.parse(issue.fields.resolutiondate) : NaN;
        if (Number.isFinite(created) && Number.isFinite(resolved) && resolved >= created) {
          deltas.push((resolved - created) / (1000 * 60 * 60));
        }
      }
      if (deltas.length > 0) {
        mttrHours = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
      }
    }

    const highestJql = `${projectClause} AND ${bugType} AND ${activeFilter} AND priority = "Highest"`;
    const highJql = `${projectClause} AND ${bugType} AND ${activeFilter} AND priority = "High"`;
    const criticalJql = `${projectClause} AND ${bugType} AND ${activeFilter} AND priority in (Highest, High) ORDER BY priority DESC, updated DESC`;

    const stats: JiraBugStats = {
      openP0: openP0.length,
      openP1: openP1.length,
      openTickets: openAll.length,
      inProgress: inProg.length,
      waiting: waiting.length,
      weeklyOpened: weeklyOpened.length,
      weeklyClosed: weeklyClosed.length,
      weeklyRegression: weeklyRegression.length,
      mttrHours,
      projectKey,
      available: true,
      highestBugsUrl: buildFilterUrl(highestJql),
      highBugsUrl: buildFilterUrl(highJql),
      criticalBugsUrl: buildFilterUrl(criticalJql),
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/jira/bug-stats]", err);
    return NextResponse.json(
      {
        openP0: 0, openP1: 0, openTickets: 0, inProgress: 0, waiting: 0,
        weeklyOpened: 0, weeklyClosed: 0, weeklyRegression: 0,
        mttrHours: null, projectKey, available: false,
        error: (err as Error).message,
      },
      { status: 200 }
    );
  }
}
