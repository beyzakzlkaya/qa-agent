/**
 * lib/domain-agent/context-builder.ts
 *
 * Builds a domain context string for injection into LLM prompts.
 */

import { searchDomain } from "./search";

const SCORE_THRESHOLD = 0.65;
const TOP_K = 8;

export async function buildDomainContext(task: string): Promise<string> {
  try {
    const results = await searchDomain(task, TOP_K);
    const filtered = results.filter((r) => r.score >= SCORE_THRESHOLD);

    if (filtered.length === 0) return "";

    const sections = filtered
      .map((r) => `### ${r.sourceFile}\n${r.chunkText}`)
      .join("\n\n");

    return `## Getmobil Domain Context\n\n${sections}`;
  } catch (err) {
    console.warn(
      `[domain-agent] buildDomainContext hatası: ${(err as Error).message}`
    );
    return "";
  }
}
