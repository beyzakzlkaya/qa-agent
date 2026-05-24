/**
 * lib/risk-analyzer/pr-fetcher.ts
 *
 * Fetches PR metadata and file diffs from GitHub REST API.
 */

import { githubGet } from "../jira-pipeline/api-clients";
import type { PRDiff, ChangedFile } from "./types";

interface GithubPR {
  number: number;
  title: string;
  body: string | null;
  additions: number;
  deletions: number;
}

interface GithubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export async function fetchPRDiff(
  prNumber: number,
  owner?: string,
  repo?: string
): Promise<PRDiff> {
  const repoOwner =
    owner ?? process.env.GITHUB_REPO_OWNER ?? process.env.GITHUB_OWNER ?? "Getmobil";

  // Support comma-separated repos — use first one if no explicit repo given
  const repoName =
    repo ??
    (process.env.GITHUB_REPOS ?? "")
      .split(",")[0]
      ?.replace(/.*\//, "")
      .trim() ??
    "";

  if (!repoName) {
    throw new Error(
      "GITHUB_REPOS veya repo parametresi gerekli. .env.local dosyasına ekleyin."
    );
  }

  console.log(
    `[risk-analyzer] PR diff alınıyor: ${repoOwner}/${repoName}#${prNumber}`
  );

  const [prData, filesData] = await Promise.all([
    githubGet<GithubPR>(
      `/repos/${repoOwner}/${repoName}/pulls/${prNumber}`
    ),
    githubGet<GithubPRFile[]>(
      `/repos/${repoOwner}/${repoName}/pulls/${prNumber}/files?per_page=100`
    ),
  ]);

  const changedFiles: ChangedFile[] = (
    Array.isArray(filesData) ? filesData : []
  ).map((f) => ({
    filename: f.filename,
    status: (["added", "modified", "deleted", "renamed"].includes(f.status)
      ? f.status
      : "modified") as ChangedFile["status"],
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ? f.patch.slice(0, 3000) : undefined,
  }));

  return {
    prNumber,
    title: prData.title ?? "",
    description: (prData.body ?? "").slice(0, 2000),
    changedFiles,
    additions: prData.additions ?? changedFiles.reduce((s, f) => s + f.additions, 0),
    deletions: prData.deletions ?? changedFiles.reduce((s, f) => s + f.deletions, 0),
  };
}
