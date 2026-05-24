#!/usr/bin/env tsx
/**
 * scripts/index-domain.ts
 *
 * CLI script to index the Getmobil domain repository into the local SQLite DB.
 *
 * Usage:
 *   npx tsx scripts/index-domain.ts
 *   npx tsx scripts/index-domain.ts --refresh
 */

import "dotenv/config";
import { indexRepository } from "../lib/domain-agent/indexer";

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");

const owner = process.env.GITHUB_OWNER ?? process.env.GITHUB_REPO_OWNER ?? "Getmobil";
const repo =
  process.env.GITHUB_REPO ??
  process.env.PROMPT_LIBRARY_REPO_NAME ??
  "getmobil-e2e-test-prompt-library";
const token = process.env.GITHUB_TOKEN ?? "";

if (!token) {
  console.error("[index-domain] GITHUB_TOKEN .env.local dosyasında tanımlı değil.");
  process.exit(1);
}

console.log(`[index-domain] Repository: ${owner}/${repo}`);
if (refresh) {
  console.log("[index-domain] --refresh: Mevcut embedding'ler silinecek");
}

(async () => {
  try {
    const result = await indexRepository(owner, repo, refresh);
    console.log("\n✅ Index tamamlandı:");
    console.log(`   Dosya işlendi: ${result.filesProcessed}`);
    console.log(`   Chunk indekslendi: ${result.chunksIndexed}`);
    console.log(`   Süre: ${result.durationMs}ms`);
  } catch (err) {
    console.error("[index-domain] Hata:", (err as Error).message);
    process.exit(1);
  }
})();
