/**
 * lib/jira-pipeline/pr-analyzer.ts
 *
 * GitHub REST API ile PR başlığı, açıklaması, değişen dosyalar ve
 * gerçek kod diff'lerini (patch) alır → test case üretimine anlamlı
 * context sağlamak için codeChangeSummary üretir.
 */

import type { PrAnalysis, PrFileChange } from "../types";
import { githubGet } from "./api-clients";

// ── PR URL parser ─────────────────────────────────────────────────────────────

function parsePrUrl(
  prUrl: string
): { owner: string; repo: string; prNumber: number } | null {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], prNumber: parseInt(m[3], 10) };
}

// ── File change categorizer ────────────────────────────────────────────────────

function categorizeDiff(files: string[]): string {
  const categories: Record<string, string[]> = {
    frontend: [],
    backend: [],
    config: [],
    test: [],
    other: [],
  };

  for (const f of files) {
    if (/\.(tsx?|jsx?|vue|svelte|css|scss|html)$/.test(f)) {
      categories.frontend.push(f);
    } else if (/\.(py|go|java|rb|php|cs|kt|swift)$/.test(f)) {
      categories.backend.push(f);
    } else if (/\.(json|yaml|yml|toml|env|config\.|\.conf)/.test(f)) {
      categories.config.push(f);
    } else if (/\.(test|spec|e2e)\.|__tests__|cypress|playwright/.test(f)) {
      categories.test.push(f);
    } else {
      categories.other.push(f);
    }
  }

  const parts: string[] = [];
  if (categories.frontend.length > 0)
    parts.push(
      `Frontend (${categories.frontend.length} dosya): ${categories.frontend.slice(0, 5).join(", ")}`
    );
  if (categories.backend.length > 0)
    parts.push(
      `Backend (${categories.backend.length} dosya): ${categories.backend.slice(0, 5).join(", ")}`
    );
  if (categories.config.length > 0)
    parts.push(`Config (${categories.config.length} dosya)`);
  if (categories.test.length > 0)
    parts.push(`Test (${categories.test.length} dosya)`);

  return parts.join("; ") || files.slice(0, 10).join(", ");
}

function inferTriggerAction(
  files: string[],
  title: string,
  body: string
): string {
  const allText = (title + " " + body + " " + files.join(" ")).toLowerCase();

  if (/login|sign.in|auth|otp|password/.test(allText))
    return "User login veya authentication akışını tetikler";
  if (/register|sign.up|kayıt|üye/.test(allText))
    return "Kullanıcı kayıt akışını tetikler";
  if (/search|arama|filtre|filter/.test(allText))
    return "Arama veya filtreleme aksiyonunu tetikler";
  if (/product|ürün|listing|katalog/.test(allText))
    return "Ürün listeleme veya detay sayfasını tetikler";
  if (/profile|hesap|account|settings|ayar/.test(allText))
    return "Kullanıcı profil veya ayarlar sayfasını tetikler";
  if (/dashboard|panel|home|ana sayfa/.test(allText))
    return "Dashboard veya ana sayfa yüklenmesini tetikler";
  if (/notification|bildirim/.test(allText))
    return "Bildirim akışını tetikler";

  return "Değişen UI bileşeninin doğrudan kullanıcı etkileşimini tetikler";
}

// ── Patch → anlamlı özet ───────────────────────────────────────────────────────

/**
 * Bir dosyanın ham patch'inden eklenen/silinen satırları çıkarır ve
 * ne değiştiğini anlatan kısa bir özet üretir.
 */
function summarizePatch(filename: string, patch: string, additions: number, deletions: number): string {
  const addedLines = patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 3 && !/^[\s{}();,]*$/.test(l))
    .slice(0, 12);

  const removedLines = patch
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 3 && !/^[\s{}();,]*$/.test(l))
    .slice(0, 6);

  const parts: string[] = [`📄 **${filename}** (+${additions}/-${deletions})`];
  if (addedLines.length > 0) {
    parts.push(`  Eklenenler: ${addedLines.slice(0, 5).join(" | ")}`);
  }
  if (removedLines.length > 0) {
    parts.push(`  Silinenler: ${removedLines.slice(0, 3).join(" | ")}`);
  }
  return parts.join("\n");
}

/**
 * Tüm file changes'tan "Bu PR'da ne değişti?" sorusuna cevap veren
 * anlamlı bir kod değişiklik özeti üretir.
 */
function buildCodeChangeSummary(fileChanges: PrFileChange[]): string {
  if (fileChanges.length === 0) return "Kod değişikliği detayı alınamadı.";

  const lines: string[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const f of fileChanges) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
    if (f.patch && (f.additions > 0 || f.deletions > 0)) {
      lines.push(summarizePatch(f.filename, f.patch, f.additions, f.deletions));
    } else {
      lines.push(`📄 **${f.filename}** (${f.status}, +${f.additions}/-${f.deletions})`);
    }
  }

  const header = `Toplam değişiklik: +${totalAdditions} ekleme / -${totalDeletions} silme, ${fileChanges.length} dosya`;
  return [header, "", ...lines].join("\n");
}

// ── GitHub REST API types ──────────────────────────────────────────────────────

interface GithubPR {
  title: string;
  body: string | null;
  html_url: string;
}

interface GithubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function analyzePR(prUrl: string): Promise<PrAnalysis> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    throw new Error(`Geçersiz PR URL formatı: ${prUrl}`);
  }

  const { owner, repo, prNumber } = parsed;
  console.log(`[jira-pipeline] PR analiz ediliyor: ${owner}/${repo}#${prNumber}`);

  const [prData, filesData] = await Promise.all([
    githubGet<GithubPR>(`/repos/${owner}/${repo}/pulls/${prNumber}`),
    githubGet<GithubPRFile[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
    ),
  ]);

  const title = prData?.title ?? "";
  const description = prData?.body ?? "";
  const rawFiles = Array.isArray(filesData) ? filesData : [];

  const changedFiles = rawFiles.map((f) => f.filename);

  // Gerçek diff patch'leriyle birlikte detaylı dosya değişiklik bilgisi
  const fileChanges: PrFileChange[] = rawFiles.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    // Her dosyanın patch'ini en fazla 2500 karakter alıyoruz (token israfını önlemek için)
    patch: f.patch ? f.patch.slice(0, 2500) : undefined,
  }));

  const diffSummary = categorizeDiff(changedFiles);
  const codeChangeSummary = buildCodeChangeSummary(fileChanges);
  const triggerAction = inferTriggerAction(changedFiles, title, description);

  console.log(
    `[jira-pipeline] PR analizi tamamlandı: "${title}" | ${changedFiles.length} dosya değişti | ` +
    `patch'ler alındı: ${fileChanges.filter((f) => f.patch).length} dosya`
  );

  return {
    title,
    description: description.slice(0, 2000),
    changedFiles,
    fileChanges,
    diffSummary,
    codeChangeSummary,
    triggerAction,
    prNumber,
    prUrl,
  };
}

export async function analyzePRSafe(
  prUrl?: string
): Promise<PrAnalysis | null> {
  if (!prUrl) return null;
  try {
    return await analyzePR(prUrl);
  } catch (err) {
    console.warn("[jira-pipeline] PR analizi başarısız:", (err as Error).message);
    return null;
  }
}
