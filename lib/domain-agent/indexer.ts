/**
 * lib/domain-agent/indexer.ts
 *
 * Fetches all .md and .txt files from a GitHub repository,
 * splits them into chunks, generates Voyage-3 embeddings via
 * Anthropic API, and stores them in SQLite.
 */

import { getDb } from "../db/index";
import { githubGet } from "../jira-pipeline/api-clients";
import type { IndexResult } from "./types";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "voyage-3";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MAX_CHUNK_TOKENS = 512;
const OVERLAP_TOKENS = 50;
// Rough approximation: 1 token ≈ 4 chars
const CHARS_PER_TOKEN = 4;
const CHUNK_SIZE = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_SIZE = OVERLAP_TOKENS * CHARS_PER_TOKEN;

// ── SQLite table init ──────────────────────────────────────────────────────────

export function ensureDomainEmbeddingsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_domain_embeddings_source ON domain_embeddings(source_file);
  `);
}

// ── GitHub tree fetcher ────────────────────────────────────────────────────────

interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
  url: string;
}

interface GitHubTree {
  tree: GitHubTreeItem[];
}

interface GitHubBlob {
  content: string;
  encoding: string;
}

async function fetchRepoFiles(
  owner: string,
  repo: string
): Promise<{ path: string; content: string }[]> {
  const branchData = await githubGet<{ commit: { sha: string } }>(
    `/repos/${owner}/${repo}/branches/main`
  ).catch(() =>
    githubGet<{ commit: { sha: string } }>(
      `/repos/${owner}/${repo}/branches/master`
    )
  );

  const sha = branchData.commit.sha;
  const treeData = await githubGet<GitHubTree>(
    `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
  );

  const mdFiles = treeData.tree.filter(
    (item) =>
      item.type === "blob" &&
      (item.path.endsWith(".md") || item.path.endsWith(".txt"))
  );

  console.log(`[domain-agent] ${mdFiles.length} .md/.txt dosyası bulundu`);

  const results: { path: string; content: string }[] = [];

  for (const file of mdFiles) {
    try {
      const blob = await githubGet<GitHubBlob>(file.url);
      const content =
        blob.encoding === "base64"
          ? Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString(
              "utf-8"
            )
          : blob.content;
      results.push({ path: file.path, content });
    } catch (err) {
      console.warn(
        `[domain-agent] ${file.path} alınamadı: ${(err as Error).message}`
      );
    }
  }

  return results;
}

// ── Chunker ────────────────────────────────────────────────────────────────────

interface Chunk {
  text: string;
  index: number;
  heading?: string;
}

function chunkText(content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const headingRegex = /^#{1,6}\s+.+$/m;

  // Split by headings first
  const sections = content.split(/(?=^#{1,6}\s)/m);
  let chunkIdx = 0;

  for (const section of sections) {
    if (!section.trim()) continue;

    // Extract heading from the section
    const headingMatch = section.match(/^(#{1,6}\s+.+)$/m);
    const heading = headingMatch ? headingMatch[1].trim() : undefined;

    if (section.length <= CHUNK_SIZE) {
      chunks.push({ text: section.trim(), index: chunkIdx++, heading });
    } else {
      // Large section → split into overlapping chunks
      let start = 0;
      while (start < section.length) {
        const end = Math.min(start + CHUNK_SIZE, section.length);
        const chunkText = section.slice(start, end).trim();
        if (chunkText) {
          chunks.push({ text: chunkText, index: chunkIdx++, heading });
        }
        start += CHUNK_SIZE - OVERLAP_SIZE;
      }
    }
  }

  // Fallback for content without headings
  if (chunks.length === 0 && content.trim()) {
    let start = 0;
    let idx = 0;
    while (start < content.length) {
      const end = Math.min(start + CHUNK_SIZE, content.length);
      const text = content.slice(start, end).trim();
      if (text) chunks.push({ text, index: idx++ });
      start += CHUNK_SIZE - OVERLAP_SIZE;
    }
  }

  // Suppress unused import warning
  void headingRegex;

  return chunks;
}

// ── Embedding API ──────────────────────────────────────────────────────────────

async function generateEmbeddings(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    // Fall back to Voyage embeddings endpoint
    const voyageRes = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY ?? ANTHROPIC_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        input_type: inputType,
      }),
    });

    if (!voyageRes.ok) {
      const text = await voyageRes.text().catch(() => "");
      throw new Error(
        `Embedding API hatası: HTTP ${voyageRes.status} — ${text.slice(0, 200)}`
      );
    }

    const data = (await voyageRes.json()) as {
      data: { embedding: number[] }[];
    };
    return data.data.map((d) => d.embedding);
  }

  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

// ── Float32Array serialization ─────────────────────────────────────────────────

function embeddingToBuffer(embedding: number[]): Buffer {
  const arr = new Float32Array(embedding);
  return Buffer.from(arr.buffer);
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function indexRepository(
  owner: string,
  repo: string,
  refresh = false,
  options: { onProgress?: (msg: string) => void } = {}
): Promise<IndexResult> {
  const start = Date.now();
  const log = options.onProgress ?? ((msg: string) => console.log(`[domain-agent] ${msg}`));
  ensureDomainEmbeddingsTable();
  const db = getDb();

  if (refresh) {
    db.prepare("DELETE FROM domain_embeddings").run();
    log("Mevcut embedding'ler silindi (--refresh)");
    console.log("[domain-agent] Mevcut embedding'ler silindi (--refresh)");
  }

  log(`${owner}/${repo} reposu okunuyor...`);
  const files = await fetchRepoFiles(owner, repo);
  log(`${files.length} dosya bulundu`);
  let chunksIndexed = 0;

  const insertStmt = db.prepare(`
    INSERT INTO domain_embeddings (source_file, chunk_index, chunk_text, embedding, metadata)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const file of files) {
    const chunks = chunkText(file.content);
    if (chunks.length === 0) continue;

    log(`İşleniyor: ${file.path} (${chunks.length} chunk)`);
    console.log(
      `[domain-agent] ${file.path}: ${chunks.length} chunk embedding'leniyor...`
    );

    try {
      // Process in batches of 8 to respect API limits
      const BATCH = 8;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const texts = batch.map((c) => c.text);
        const embeddings = await generateEmbeddings(texts, "document");

        const insertBatch = db.transaction(() => {
          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const embeddingBuf = embeddingToBuffer(embeddings[j]);
            const metadata = JSON.stringify({
              heading: chunk.heading,
              file_type: file.path.endsWith(".md") ? "markdown" : "text",
              repo: `${owner}/${repo}`,
            });
            insertStmt.run(
              file.path,
              chunk.index,
              chunk.text,
              embeddingBuf,
              metadata
            );
            chunksIndexed++;
          }
        });
        insertBatch();
      }
    } catch (err) {
      const errMsg = `${file.path} embedding hatası: ${(err as Error).message}`;
      log(errMsg);
      console.error(`[domain-agent] ${errMsg}`);
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `[domain-agent] Index tamamlandı: ${files.length} dosya, ${chunksIndexed} chunk, ${durationMs}ms`
  );

  return { filesProcessed: files.length, chunksIndexed, durationMs };
}
