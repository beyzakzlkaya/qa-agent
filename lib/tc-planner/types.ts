import type { RiskAnalysis, SuggestedScenario } from "../risk-analyzer/types";
import type { Platform } from "../types";

export interface TestPlanOptions {
  riskAnalysis?: RiskAnalysis;
  manualPrompt?: string;
  targetScreens?: Platform[];
  maxTestCases?: number;
  includeRegression?: boolean;
}

export interface PrioritizedTestCase {
  testCaseId: string;
  priority: number;
  reason: string;
  riskScore: number;
  targetScreen: string;
}

export interface TestPlan {
  id: string;
  source: "pr" | "jira" | "manual";
  priority: PrioritizedTestCase[];
  estimatedDurationMinutes: number;
  coverageAreas: string[];
  newScenariosToGenerate: SuggestedScenario[];
  createdAt: string;
}

export interface TestPlanRow {
  id: string;
  source: string;
  plan_json: string;
  created_at: string;
}

export type { SuggestedScenario };
