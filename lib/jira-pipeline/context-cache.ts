/**
 * lib/jira-pipeline/context-cache.ts
 *
 * GitHub REST API ile getmobil-e2e-test-prompt-library reposundan
 * domain/TC dokümanlarını çeker ve session boyunca cache'ler.
 *
 * Repo yapısı:
 *   domains/{domain}/README.md          → domain açıklaması
 *   domains/{domain}/TC-*.md            → test case dokümanları
 *   domains/{domain}/{subdir}/TC-*.md   → alt-domain TC dokümanları
 *   _shared/fixtures/*.md               → ortak test verileri
 *   _shared/utilities/common-flows.md   → ortak akışlar
 *
 * Cache kuralı: Aynı process ömründe bir kere çekilir.
 * "context güncelle" komutu gelirse clearContextCache() çağrılır.
 */

import type { ContextCache } from "../types";
import { githubGet } from "./api-clients";

const REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "Getmobil";
const REPO_NAME = process.env.PROMPT_LIBRARY_REPO_NAME ?? "getmobil-e2e-test-prompt-library";

let _cache: ContextCache | null = null;

export function clearContextCache(): void {
  _cache = null;
}

export function getCachedContext(): ContextCache | null {
  return _cache;
}

// ── GitHub REST API file helpers ───────────────────────────────────────────────

interface GithubFileContent {
  content?: string;
  encoding?: string;
  type?: string;
}

interface GithubDirEntry {
  name: string;
  type: string;
  path: string;
}

async function fetchRepoFile(path: string): Promise<string> {
  try {
    const result = await githubGet<GithubFileContent>(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`
    );
    if (!result?.content) return "";
    return result.encoding === "base64"
      ? Buffer.from(result.content.replace(/\n/g, ""), "base64").toString("utf-8")
      : result.content;
  } catch {
    return "";
  }
}

async function listRepoDir(dir: string): Promise<GithubDirEntry[]> {
  try {
    const result = await githubGet<GithubDirEntry[]>(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${dir}`
    );
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Bir dizindeki tüm .md dosyalarını recursive olarak toplar.
 * key: dosyanın repo içindeki path'i (uzantısız, kısa)
 */
async function fetchMdFilesRecursive(
  dir: string,
  maxDepth = 2,
  currentDepth = 0
): Promise<Record<string, string>> {
  const entries = await listRepoDir(dir);
  const result: Record<string, string> = {};

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.type === "file" && entry.name.endsWith(".md")) {
        const content = await fetchRepoFile(entry.path);
        if (content.length > 0) {
          // key: "domains/backoffice/TC-BO-001-..." → "backoffice/TC-BO-001-..."
          const key = entry.path
            .replace(/^domains\//, "")
            .replace(/^_shared\//, "shared/")
            .replace(/\.md$/, "");
          result[key] = content;
        }
      } else if (entry.type === "dir" && currentDepth < maxDepth) {
        const sub = await fetchMdFilesRecursive(entry.path, maxDepth, currentDepth + 1);
        Object.assign(result, sub);
      }
    })
  );

  return result;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function loadContext(signal?: AbortSignal): Promise<ContextCache> {
  if (_cache) return _cache;

  console.log(
    `[jira-pipeline] Context yükleniyor: ${REPO_OWNER}/${REPO_NAME}`
  );

  if (signal?.aborted) {
    _cache = { domains: {}, flows: {}, selectors: {}, testCases: {}, loadedAt: new Date().toISOString() };
    return _cache;
  }

  // domains/ altındaki tüm TC dokümanları ve README'ler
  const [domainFiles, sharedFiles] = await Promise.all([
    fetchMdFilesRecursive("domains", 2),
    fetchMdFilesRecursive("_shared", 1),
  ]);

  // domains: sadece README.md dosyaları (domain açıklamaları)
  const domains: Record<string, string> = {};
  // testCases: TC-*.md dosyaları (asıl test dokümanları)
  const testCases: Record<string, string> = {};

  for (const [key, content] of Object.entries(domainFiles)) {
    if (key.endsWith("README") || key.endsWith("readme")) {
      // "backoffice/README" → "backoffice"
      const domainKey = key.replace(/\/README$/i, "").replace(/\/readme$/i, "");
      domains[domainKey] = content;
    } else {
      testCases[key] = content;
    }
  }

  // flows: _shared/utilities/common-flows içeriği
  const flows: Record<string, string> = {};
  for (const [key, content] of Object.entries(sharedFiles)) {
    flows[key] = content;
  }

  // selectors: boş (repo'da selector klasörü yok)
  const selectors: Record<string, string> = {};

  _cache = {
    domains,
    flows,
    selectors,
    testCases,
    loadedAt: new Date().toISOString(),
  };

  const total = Object.keys(domains).length + Object.keys(testCases).length + Object.keys(flows).length;
  console.log(
    `[jira-pipeline] Context yüklendi: ${total} dosya ` +
    `(${Object.keys(domains).length} domain README, ` +
    `${Object.keys(testCases).length} TC dokümanı, ` +
    `${Object.keys(flows).length} shared flow)`
  );

  return _cache;
}

export function contextToString(ctx: ContextCache): string {
  const sections: string[] = [];

  if (Object.keys(ctx.testCases).length > 0) {
    sections.push(
      "## Test Case Dokümantasyonu\n" +
        Object.entries(ctx.testCases)
          .map(([k, v]) => `### ${k}\n${v.slice(0, 1000)}`)
          .join("\n\n")
    );
  }

  if (Object.keys(ctx.domains).length > 0) {
    sections.push(
      "## Domain Açıklamaları\n" +
        Object.entries(ctx.domains)
          .map(([k, v]) => `### ${k}\n${v.slice(0, 600)}`)
          .join("\n\n")
    );
  }

  if (Object.keys(ctx.flows).length > 0) {
    sections.push(
      "## Ortak Akışlar\n" +
        Object.entries(ctx.flows)
          .map(([k, v]) => `### ${k}\n${v.slice(0, 600)}`)
          .join("\n\n")
    );
  }

  return sections.join("\n\n");
}
