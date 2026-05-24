export interface IndexResult {
  filesProcessed: number;
  chunksIndexed: number;
  durationMs: number;
}

export interface SearchResult {
  chunkText: string;
  sourceFile: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface EmbeddingRow {
  id: number;
  source_file: string;
  chunk_index: number;
  chunk_text: string;
  embedding: Buffer;
  metadata: string;
  created_at: string;
}
