export interface PRDiff {
  prNumber: number;
  title: string;
  description: string;
  changedFiles: ChangedFile[];
  additions: number;
  deletions: number;
}

export interface ChangedFile {
  filename: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface SuggestedScenario {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  targetScreen: "backoffice" | "partner" | "website";
}

export interface RiskAnalysis {
  riskLevel: "low" | "medium" | "high" | "critical";
  riskScore: number;
  riskReasons: string[];
  affectedScreens: string[];
  affectedServices: string[];
  regressionRisk: string[];
  newFeaturesDetected: string[];
  prioritizedTestAreas: string[];
  suggestedTestCaseIds: string[];
  suggestedNewTestScenarios: SuggestedScenario[];
  prNumber: number;
  analyzedAt: string;
}
