/**
 * lib/jira-pipeline/api-clients.ts
 *
 * JIRA REST API v3 ve GitHub REST API istemcileri.
 * Cloudflare Access korumalı MCP SSE endpoint'leri server-side koddan
 * erişilemediği için doğrudan REST API kullanıyoruz.
 *
 * Gerekli env değişkenleri (.env.local):
 *   JIRA_BASE_URL   — örn. https://yourcompany.atlassian.net
 *   JIRA_EMAIL      — Atlassian hesap e-postası
 *   JIRA_API_TOKEN  — https://id.atlassian.com/manage-profile/security/api-tokens
 *   GITHUB_TOKEN    — https://github.com/settings/tokens (repo scope)
 */

// ── JIRA REST API ──────────────────────────────────────────────────────────────

function getJiraBaseUrl(): string {
  const url = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
  if (!url) {
    throw new Error("JIRA_BASE_URL .env.local dosyasında tanımlı değil.");
  }
  return url;
}

function getJiraHeaders(): HeadersInit {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    throw new Error(
      "JIRA kimlik bilgileri eksik. .env.local dosyasına JIRA_EMAIL ve JIRA_API_TOKEN ekleyin."
    );
  }

  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function jiraGet<T = unknown>(path: string): Promise<T> {
  const url = `${getJiraBaseUrl()}/rest/api/3${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: getJiraHeaders(),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `JIRA API GET ${path} başarısız: HTTP ${res.status} — ${body.slice(0, 200)}`
    );
  }

  return res.json() as Promise<T>;
}

export async function jiraPost<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const url = `${getJiraBaseUrl()}/rest/api/3${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: getJiraHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `JIRA API POST ${path} başarısız: HTTP ${res.status} — ${text.slice(0, 200)}`
    );
  }

  return res.json() as Promise<T>;
}

// ── JIRA Transitions ───────────────────────────────────────────────────────────

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; id: string };
}

export async function getTransitions(issueKey: string): Promise<JiraTransition[]> {
  const data = await jiraGet<{ transitions: JiraTransition[] }>(
    `/issue/${issueKey}/transitions`
  );
  return data.transitions ?? [];
}

/**
 * Searches available transitions for one whose name contains the given
 * keyword (case-insensitive) and executes it.
 * Returns true if the transition was applied, false if not found.
 */
export async function transitionIssue(
  issueKey: string,
  targetStatusName: string
): Promise<boolean> {
  const transitions = await getTransitions(issueKey);
  const match = transitions.find((t) =>
    t.name.toLowerCase().includes(targetStatusName.toLowerCase()) ||
    t.to.name.toLowerCase().includes(targetStatusName.toLowerCase())
  );

  if (!match) {
    console.warn(
      `[jira] "${targetStatusName}" için geçiş bulunamadı. Mevcut geçişler: ${transitions.map((t) => t.name).join(", ")}`
    );
    return false;
  }

  const url = `${getJiraBaseUrl()}/rest/api/3/issue/${issueKey}/transitions`;
  const res = await fetch(url, {
    method: "POST",
    headers: getJiraHeaders(),
    body: JSON.stringify({ transition: { id: match.id } }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `JIRA transition başarısız (${issueKey} → ${match.name}): HTTP ${res.status} — ${text.slice(0, 200)}`
    );
  }

  console.log(`[jira] ${issueKey} durumu değiştirildi → ${match.to.name}`);
  return true;
}

// ── GitHub REST API ────────────────────────────────────────────────────────────

function getGithubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      "[github] GITHUB_TOKEN tanımlı değil. Kimlik doğrulamasız istekler GitHub rate limitine (60 req/saat) tabidir."
    );
  }
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function githubGet<T = unknown>(path: string): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `https://api.github.com${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: getGithubHeaders(),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API GET ${path} başarısız: HTTP ${res.status} — ${body.slice(0, 200)}`
    );
  }

  return res.json() as Promise<T>;
}
