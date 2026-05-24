/**
 * lib/domain-agent/index.ts
 *
 * Public API for the domain-agent module.
 */

export { indexRepository, ensureDomainEmbeddingsTable } from "./indexer";
export { searchDomain } from "./search";
export { buildDomainContext } from "./context-builder";
export type { IndexResult, SearchResult } from "./types";
