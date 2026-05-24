import { NextRequest, NextResponse } from "next/server";
import { jiraPost } from "@/lib/jira-pipeline/api-clients";

export type PipelineStatusKey =
  | "todo"
  | "inProgress"
  | "readyForCR"
  | "readyForQA"
  | "inQA"
  | "readyToRelease"
  | "liveTest"
  | "done"
  | "returnedFromQa";

export interface PipelineStatusTile {
  key: PipelineStatusKey;
  label: string;
  status: string;
  count: number;
  jql: string;
  url: string;
}

export interface PipelineStatsResp {
  tiles: PipelineStatusTile[];
  projectKey: string;
  available: boolean;
}

const STATUS_MAP: { key: Exclude<PipelineStatusKey, "returnedFromQa">; label: string; status: string }[] = [
  { key: "todo", label: "Açılan", status: "TO DO" },
  { key: "inProgress", label: "Geliştirme aşamasında", status: "In Progress" },
  { key: "readyForCR", label: "Test bekleyen", status: "READY FOR CR" },
  { key: "readyForQA", label: "Teste hazır", status: "READY FOR QA" },
  { key: "inQA", label: "Test aşamasında", status: "IN QA" },
  { key: "readyToRelease", label: "Canlıya çıkmaya hazır", status: "RTR" },
  { key: "liveTest", label: "Canlıda test aşamasında", status: "LIVE TESTING" },
  { key: "done", label: "Çözülen", status: "Done" },
];

/** Restrict to "currently active" work — JIRA's openSprints() context. */
const ACTIVE_FILTER = "sprint in openSprints()";

async function countByJql(jql: string): Promise<number> {
  try {
    const res = await jiraPost<{ count?: number }>("/search/approximate-count", { jql });
    return typeof res.count === "number" ? res.count : 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectKey = searchParams.get("project") ?? process.env.JIRA_PROJECT_KEY ?? "NE";
  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");

  if (!baseUrl || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    return NextResponse.json({
      tiles: [],
      projectKey,
      available: false,
    } as PipelineStatsResp);
  }

  const buildJql = (status: string) =>
    `project = "${projectKey}" AND status = "${status}" AND ${ACTIVE_FILTER}`;

  const buildUrl = (jql: string) =>
    `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`;

  // 8 status counts in parallel + returnedFromQa via JQL — all scoped to active sprints
  const statusJqls = STATUS_MAP.map(({ status }) => buildJql(status));

  // Returned-from-QA: tasks in active sprints whose history shows IN QA → IN PROGRESS
  const returnedJql = `project = "${projectKey}" AND ${ACTIVE_FILTER} AND status changed FROM "IN QA" TO "In Progress"`;

  const counts = await Promise.all([
    ...statusJqls.map(countByJql),
    countByJql(returnedJql),
  ]);

  const tiles: PipelineStatusTile[] = STATUS_MAP.map((m, i) => ({
    key: m.key,
    label: m.label,
    status: m.status,
    count: counts[i],
    jql: statusJqls[i],
    url: buildUrl(statusJqls[i]),
  }));

  tiles.push({
    key: "returnedFromQa",
    label: "Testten dönen işler",
    status: "RETURNED",
    count: counts[counts.length - 1],
    jql: returnedJql,
    url: buildUrl(returnedJql),
  });

  return NextResponse.json({ tiles, projectKey, available: true } as PipelineStatsResp);
}
