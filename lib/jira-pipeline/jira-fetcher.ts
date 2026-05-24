/**
 * lib/jira-pipeline/jira-fetcher.ts
 *
 * JIRA REST API v3 ile task detaylarını çeker.
 * PR URL yoksa taskKey'den branch adını tahmin eder ve GitHub REST API ile arar.
 */

import type { JiraTaskMeta } from "../types";
import { jiraGet, githubGet } from "./api-clients";

// ── Branch hint derivation ─────────────────────────────────────────────────────

function deriveBranchHints(taskKey: string): string[] {
  const lower = taskKey.toLowerCase();
  return [
    `feature/${taskKey}`,
    `feature/${lower}`,
    `fix/${taskKey}`,
    `fix/${lower}`,
    `bugfix/${taskKey}`,
    `bugfix/${lower}`,
    taskKey,
    lower,
  ];
}

// Env'den repo listesini parse et: "repo1,repo2,repo3" → ["repo1", "repo2", "repo3"]
function getRepoList(): string[] {
  const raw = process.env.GITHUB_REPOS ?? process.env.GITHUB_REPO_NAME ?? "getmobil";
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

async function findPrByBranch(
  taskKey: string
): Promise<{ prUrl?: string; branchHint?: string }> {
  const owner = process.env.GITHUB_REPO_OWNER ?? "Getmobil";
  const repos = getRepoList();
  const hints = deriveBranchHints(taskKey);

  // 1) GitHub Search API: org genelinde tek sorguda tüm repolar taranır
  try {
    const searchResult = await githubGet<{
      items?: Array<{ number: number; html_url: string; head: { ref: string }; title: string; repository_url: string }>;
    }>(
      `/search/issues?q=${encodeURIComponent(`${taskKey} org:${owner} is:pr`)}&sort=updated&per_page=10`
    );
    if (Array.isArray(searchResult?.items) && searchResult.items.length > 0) {
      const pr = searchResult.items[0];
      const repoName = pr.repository_url?.split("/").pop() ?? "";
      console.log(`[jira-fetcher] GitHub Search ile PR bulundu: ${pr.html_url} (repo: ${repoName})`);
      return { prUrl: pr.html_url, branchHint: pr.head?.ref };
    }
  } catch (err) {
    console.warn("[jira-fetcher] GitHub Search başarısız:", (err as Error).message);
  }

  // 2) Her repoda branch adı / başlığa göre PR tara
  for (const repo of repos) {
    try {
      for (const state of ["open", "closed"] as const) {
        for (let page = 1; page <= 3; page++) {
          const prs = await githubGet<
            Array<{
              number: number;
              html_url: string;
              head: { ref: string };
              title: string;
            }>
          >(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=100&page=${page}`);

          if (!Array.isArray(prs) || prs.length === 0) break;

          for (const pr of prs) {
            const branch = pr.head?.ref ?? "";
            if (hints.some((h) => branch.toLowerCase().includes(h.toLowerCase()))) {
              console.log(`[jira-fetcher] Branch eşleşmesi ile PR bulundu: ${pr.html_url} (${repo}/${branch})`);
              return { prUrl: pr.html_url, branchHint: branch };
            }
            if (pr.title?.toUpperCase().includes(taskKey.toUpperCase())) {
              console.log(`[jira-fetcher] Başlık eşleşmesi ile PR bulundu: ${pr.html_url} (${repo})`);
              return { prUrl: pr.html_url, branchHint: branch };
            }
          }

          if (prs.length < 100) break;
        }
      }
    } catch (err) {
      console.warn(`[jira-fetcher] ${owner}/${repo} PR arama başarısız:`, (err as Error).message);
    }
  }

  return {};
}

// ── JIRA Atlassian Document Format (ADF) parser ────────────────────────────────

function extractText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;

  const n = node as Record<string, unknown>;

  if (n.type === "text" && typeof n.text === "string") return n.text;

  if (Array.isArray(n.content)) {
    return (n.content as unknown[]).map(extractText).join("");
  }

  if (n.type === "paragraph" && Array.isArray(n.content)) {
    return (n.content as unknown[]).map(extractText).join("") + "\n";
  }

  if (n.type === "bulletList" || n.type === "orderedList") {
    return (n.content as unknown[]).map(extractText).join("");
  }

  if (n.type === "listItem" && Array.isArray(n.content)) {
    return "- " + (n.content as unknown[]).map(extractText).join("") + "\n";
  }

  if (n.type === "heading" && Array.isArray(n.content)) {
    return "## " + (n.content as unknown[]).map(extractText).join("") + "\n";
  }

  return "";
}

function parseAdfToText(adf: unknown): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;

  const doc = adf as Record<string, unknown>;
  if (doc.type === "doc" && Array.isArray(doc.content)) {
    return (doc.content as unknown[]).map(extractText).join("").trim();
  }

  return extractText(adf).trim();
}

function extractPrUrlFromText(text: string): string | undefined {
  const patterns = [
    /https?:\/\/github\.com\/[^\s\)\"]+\/pull\/\d+/i,
    /https?:\/\/[^\s\)\"]*\/pull\/\d+/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return undefined;
}

function extractAcceptanceCriteria(
  description: string,
  fields: Record<string, unknown>
): string | undefined {
  const customAc =
    fields["customfield_10016"] ??
    fields["customfield_10014"] ??
    fields["customfield_acceptance_criteria"];

  if (customAc) {
    const parsed = parseAdfToText(customAc);
    if (parsed.length > 10) return parsed;
  }

  const acMatch = description.match(
    /(?:acceptance criteria|kabul kriterleri|ac)[:\s]+([\s\S]+?)(?:\n\n|\n##|$)/i
  );
  return acMatch?.[1]?.trim();
}

// ── JIRA REST API response types ───────────────────────────────────────────────

interface JiraIssueResponse {
  key: string;
  fields: {
    summary: string;
    description: unknown;
    customfield_10016?: unknown;
    customfield_10014?: unknown;
    comment?: {
      comments?: Array<{ body: unknown }>;
    };
    [key: string]: unknown;
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function fetchJiraTask(taskKey: string): Promise<JiraTaskMeta> {
  console.log(`[jira-pipeline] JIRA task çekiliyor: ${taskKey}`);

  const result = await jiraGet<JiraIssueResponse>(
    `/issue/${taskKey}?fields=summary,description,customfield_10016,customfield_10014,comment`
  );

  const fields = result?.fields ?? ({} as JiraIssueResponse["fields"]);
  const summary = String(fields.summary ?? "");
  const description = parseAdfToText(fields.description);
  const acceptanceCriteria = extractAcceptanceCriteria(description, fields as Record<string, unknown>);

  let prUrl = extractPrUrlFromText(description);
  let branchHint: string | undefined;
  const parsedComments: string[] = [];

  const rawComments = fields.comment;
  if (rawComments?.comments) {
    for (const c of rawComments.comments) {
      const commentText = parseAdfToText(c.body);
      if (commentText.trim()) {
        parsedComments.push(commentText.trim());
      }
      if (!prUrl) {
        prUrl = extractPrUrlFromText(commentText);
      }
    }
  }

  if (!prUrl) {
    // JIRA Remote Links endpoint — düz dizi döndürür: [{ object: { url, title } }]
    try {
      const remoteLinks = await jiraGet<Array<{ object?: { url?: string } }>>(`/issue/${taskKey}/remotelink`);
      const links = Array.isArray(remoteLinks) ? remoteLinks : [];
      for (const link of links) {
        const url = link.object?.url ?? "";
        if (/github\.com.*\/pull\/\d+/.test(url)) {
          prUrl = url;
          console.log(`[jira-fetcher] Remote link'ten PR URL bulundu: ${prUrl}`);
          break;
        }
      }
    } catch {
      // remote link API erişilemiyorsa sessizce geç
    }
  }

  if (!prUrl) {
    console.log(`[jira-pipeline] PR URL bulunamadı, branch araması yapılıyor...`);
    const found = await findPrByBranch(taskKey);
    prUrl = found.prUrl;
    branchHint = found.branchHint;
  }

  const meta: JiraTaskMeta = {
    key: taskKey,
    summary,
    description,
    acceptanceCriteria,
    prUrl,
    branchHint,
    comments: parsedComments.length > 0 ? parsedComments : undefined,
  };

  console.log(
    `[jira-pipeline] JIRA task yüklendi: "${summary}"` +
      (prUrl ? ` | PR: ${prUrl}` : " | PR bulunamadı") +
      (parsedComments.length > 0 ? ` | ${parsedComments.length} comment` : "")
  );

  return meta;
}
