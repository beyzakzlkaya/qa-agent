/**
 * lib/risk-analyzer/index.ts
 *
 * Public API for the risk-analyzer module.
 */

export { fetchPRDiff } from "./pr-fetcher";
export { analyzeRisk } from "./analyzer";
export type { PRDiff, ChangedFile, RiskAnalysis, SuggestedScenario } from "./types";
