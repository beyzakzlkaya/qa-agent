/**
 * lib/domain-agent/search.ts
 *
 * Semantic search over domain_embeddings table using cosine similarity.
 */

import { getDb } from "../db/index";
import { ensureDomainEmbeddingsTable } from "./indexer";
import type { SearchResult, EmbeddingRow } from "./types";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "voyage-3";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

// ── Cosine similarity (pure TypeScript / Float32Array) ────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function bufferToFloat32Array(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

// ── Query embedding ────────────────────────────────────────────────────────────

async function embedQuery(query: string): Promise<Float32Array> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  }

  const voyageRes = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY ?? ANTHROPIC_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [query],
      input_type: "query",
    }),
  });

  if (!voyageRes.ok) {
    const text = await voyageRes.text().catch(() => "");
    throw new Error(
      `Query embedding hatası: HTTP ${voyageRes.status} — ${text.slice(0, 200)}`
    );
  }

  const data = (await voyageRes.json()) as {
    data: { embedding: number[] }[];
  };
  const embedding = data.data[0]?.embedding;
  if (!embedding) throw new Error("Query embedding alınamadı");

  return new Float32Array(embedding);
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function searchDomain(
  query: string,
  topK = 5
): Promise<SearchResult[]> {
  ensureDomainEmbeddingsTable();
  const db = getDb();

  const rows = db
    .prepare("SELECT * FROM domain_embeddings")
    .all() as EmbeddingRow[];

  if (rows.length === 0) {
    console.warn(
      "[domain-agent] domain_embeddings tablosu boş. npx tsx scripts/index-domain.ts çalıştırın."
    );
    return [];
  }

  const queryVec = await embedQuery(query);

  const scored = rows.map((row) => {
    const embeddingVec = bufferToFloat32Array(row.embedding as unknown as Buffer);
    const score = cosineSimilarity(queryVec, embeddingVec);
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(({ row, score }) => ({
    chunkText: row.chunk_text,
    sourceFile: row.source_file,
    score,
    metadata: (() => {
      try {
        return JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
  }));
}
