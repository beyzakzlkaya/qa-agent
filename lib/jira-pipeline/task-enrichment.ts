/**
 * lib/jira-pipeline/task-enrichment.ts
 *
 * READY FOR QA task'ı için "kart için yeterli" zenginleştirme verisini
 * tek seferde toplar: PR meta, dosya sayısı, etkilenen modüller, tahmini
 * test case sayısı, reopen geçmişi, SLA bekleme süresi.
 *
 * Pahalı LLM çağrısı içermez — sadece JIRA + GitHub REST + heuristic.
 * LLM tabanlı risk özeti için `/api/jira/risk-summary` endpoint'i kullanılır.
 */

import { jiraGet, githubGet } from "./api-clients";
import { detectModulesFromFiles, type DetectedModule } from "./module-map";
import type { JiraTask } from "../../app/api/jira/tasks/route";

// ── Public types ──────────────────────────────────────────────────────────────

export interface JiraTaskEnrichment {
  /** PR meta — bulunamadıysa null */
  pr: PrSummary | null;
  /** Önceki kez QA'den dev'e dönüş sayısı (0 ise reopen yok) */
  reopenCount: number;
  /** Son reopen tarihi (ISO) — varsa */
  lastReopenAt: string | null;
  /** READY FOR QA durumuna geçtiği tarih (ISO) — yoksa son updated kullanılır */
  readyForQaSince: string | null;
  /** READY FOR QA'de geçen saat — eşik (24h) üzerinde SLA uyarısı için kullanılır */
  waitingHours: number;
  /** Etkilenen modül listesi (PR yoksa boş) */
  modules: DetectedModule[];
  /** Tahmini test case sayısı (heuristic) */
  estimatedCaseCount: number;
  /** Yüksek karmaşıklık sinyali (20+ dosya veya 3+ modül) */
  isHighComplexity: boolean;
  /** PR bulunamadı / başka tıkanma sebebi (sarı görünüm için) */
  stuckReason: StuckReason | null;
}

export interface PrSummary {
  /** Birden çok PR varsa toplam sayı */
  count: number;
  /** Birincil (en yeni open) PR URL'i */
  primaryUrl: string;
  primaryNumber: number;
  /** Tüm PR'lar arasında toplam dosya sayısı */
  fileCount: number;
  /** Toplam eklenen satır */
  additions: number;
  /** Toplam silinen satır */
  deletions: number;
  /** İlk N dosya — kart preview'ı için */
  topFiles: { filename: string; additions: number; deletions: number }[];
  /** PR durumu — open/closed/merged karışıksa "mixed" */
  state: "open" | "closed" | "merged" | "mixed";
}

export type StuckReason =
  | { kind: "pr_not_found"; message: string }
  | { kind: "pr_unauthorized"; message: string }
  | { kind: "task_fetch_failed"; message: string };

// ── JIRA changelog → reopen sayısı + READY FOR QA tarihi ──────────────────────

interface JiraChangelogResp {
  changelog?: {
    histories: Array<{
      created: string;
      items: Array<{ field: string; fromString?: string; toString?: string }>;
    }>;
  };
  fields?: {
    updated?: string;
  };
}

interface ChangelogSummary {
  reopenCount: number;
  lastReopenAt: string | null;
  readyForQaSince: string | null;
  fallbackUpdated: string | null;
}

async function fetchChangelog(taskKey: string): Promise<ChangelogSummary> {
  try {
    const data = await jiraGet<JiraChangelogResp>(
      `/issue/${taskKey}?expand=changelog&fields=updated`
    );
    const histories = data.changelog?.histories ?? [];
    let reopenCount = 0;
    let lastReopenAt: string | null = null;
    let readyForQaSince: string | null = null;

    const sorted = [...histories].sort((a, b) =>
      a.created.localeCompare(b.created)
    );

    for (const h of sorted) {
      for (const item of h.items) {
        if (item.field !== "status") continue;
        const from = (item.fromString ?? "").toUpperCase();
        const to = (item.toString ?? "").toUpperCase();
        if (from === "IN QA" && (to === "IN PROGRESS" || to === "TO DO")) {
          reopenCount += 1;
          lastReopenAt = h.created;
        }
        if (to === "READY FOR QA") {
          readyForQaSince = h.created;
        }
      }
    }

    return {
      reopenCount,
      lastReopenAt,
      readyForQaSince,
      fallbackUpdated: data.fields?.updated ?? null,
    };
  } catch (err) {
    console.warn(`[task-enrichment] changelog fetch failed for ${taskKey}:`, (err as Error).message);
    return { reopenCount: 0, lastReopenAt: null, readyForQaSince: null, fallbackUpdated: null };
  }
}

// ── GitHub: task'a bağlı tüm PR'ları bul + dosya meta'sını topla ──────────────

interface GithubSearchItem {
  number: number;
  html_url: string;
  state: string;
  pull_request?: { merged_at?: string | null };
  repository_url: string;
}

interface GithubPrFile {
  filename: string;
  additions: number;
  deletions: number;
}

interface PrFetchResult {
  summary: PrSummary | null;
  allFiles: GithubPrFile[];
  stuck: StuckReason | null;
}

async function fetchPrSummary(taskKey: string): Promise<PrFetchResult> {
  const owner = process.env.GITHUB_REPO_OWNER ?? "Getmobil";
  try {
    const search = await githubGet<{ items?: GithubSearchItem[] }>(
      `/search/issues?q=${encodeURIComponent(`${taskKey} org:${owner} is:pr`)}&sort=updated&per_page=5`
    );
    const items = search.items ?? [];
    if (items.length === 0) {
      return {
        summary: null,
        allFiles: [],
        stuck: { kind: "pr_not_found", message: "Task numarasına bağlı GitHub PR bulunamadı" },
      };
    }

    const sorted = [...items].sort((a, b) => {
      const aOpen = a.state === "open" ? 0 : 1;
      const bOpen = b.state === "open" ? 0 : 1;
      return aOpen - bOpen;
    });
    const primary = sorted[0];
    const repoName = primary.repository_url.split("/").pop() ?? "";
    if (!repoName) {
      return {
        summary: null,
        allFiles: [],
        stuck: { kind: "pr_not_found", message: "PR repo adı çıkarılamadı" },
      };
    }

    const states = new Set<string>();
    for (const i of items) {
      if (i.state === "closed" && i.pull_request?.merged_at) states.add("merged");
      else states.add(i.state);
    }

    let files: GithubPrFile[] = [];
    try {
      files = await githubGet<GithubPrFile[]>(
        `/repos/${owner}/${repoName}/pulls/${primary.number}/files?per_page=100`
      );
    } catch (err) {
      console.warn(`[task-enrichment] PR files fetch failed for ${taskKey}#${primary.number}:`, (err as Error).message);
    }

    const additions = files.reduce((s, f) => s + (f.additions ?? 0), 0);
    const deletions = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
    const topFiles = [...files]
      .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
      .slice(0, 5)
      .map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions }));

    const stateLabel: PrSummary["state"] =
      states.size > 1 ? "mixed" :
      states.has("merged") ? "merged" :
      states.has("open") ? "open" : "closed";

    return {
      summary: {
        count: items.length,
        primaryUrl: primary.html_url,
        primaryNumber: primary.number,
        fileCount: files.length,
        additions,
        deletions,
        topFiles,
        state: stateLabel,
      },
      allFiles: files,
      stuck: null,
    };
  } catch (err) {
    const message = (err as Error).message;
    if (/401|403/.test(message)) {
      return {
        summary: null,
        allFiles: [],
        stuck: { kind: "pr_unauthorized", message: "GitHub erişim hatası — token kontrolü gerekli" },
      };
    }
    return {
      summary: null,
      allFiles: [],
      stuck: { kind: "pr_not_found", message: `GitHub aramada hata: ${message.slice(0, 120)}` },
    };
  }
}

// ── Test case sayısı tahmini (heuristic) ──────────────────────────────────────

function estimateCaseCount(pr: PrSummary | null, modules: DetectedModule[]): number {
  if (!pr) return 4;
  const base = 3;
  const perModule = Math.min(modules.length, 5);
  const fileBucket =
    pr.fileCount === 0 ? 0 :
    pr.fileCount <= 3 ? 1 :
    pr.fileCount <= 10 ? 3 :
    pr.fileCount <= 25 ? 5 : 7;
  const churnBucket = pr.additions + pr.deletions > 500 ? 2 : pr.additions + pr.deletions > 150 ? 1 : 0;
  return base + perModule + fileBucket + churnBucket;
}

// ── SLA hesabı ────────────────────────────────────────────────────────────────

function hoursBetween(fromIso: string | null, toMs: number): number {
  if (!fromIso) return 0;
  const fromMs = Date.parse(fromIso);
  if (!Number.isFinite(fromMs)) return 0;
  return Math.max(0, (toMs - fromMs) / (1000 * 60 * 60));
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Tek bir task için tüm zenginleştirme verisini toplar.
 * Çağrı pahalı (~1-3 sn) — endpoint tarafından lazy çağrılmalı.
 */
export async function enrichJiraTask(task: Pick<JiraTask, "key" | "updated">): Promise<JiraTaskEnrichment> {
  const [changelog, prResult] = await Promise.all([
    fetchChangelog(task.key),
    fetchPrSummary(task.key),
  ]);

  const readyForQaSince = changelog.readyForQaSince ?? changelog.fallbackUpdated ?? task.updated;
  const waitingHours = hoursBetween(readyForQaSince, Date.now());

  const modules = detectModulesFromFiles(prResult.allFiles.map((f) => f.filename));
  const estimatedCaseCount = estimateCaseCount(prResult.summary, modules);
  const isHighComplexity =
    (prResult.summary?.fileCount ?? 0) >= 20 || modules.length >= 3;

  return {
    pr: prResult.summary,
    reopenCount: changelog.reopenCount,
    lastReopenAt: changelog.lastReopenAt,
    readyForQaSince,
    waitingHours,
    modules,
    estimatedCaseCount,
    isHighComplexity,
    stuckReason: prResult.stuck,
  };
}
