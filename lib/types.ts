export interface TestCase {
  id: string;
  title: string;
  platform: Platform[];
  tags: Tag[];
  priority: Priority;
  domain?: Domain;
  prompt: string;
  expectedOutcome: string;
  savedAt?: string;
  /** Full TC document markdown injected as execution context (e.g. TC-BB-001) */
  tcContext?: string;
}

export type Platform = "backoffice" | "partner" | "website";
export type Tag = "smoke" | "regression" | "monkey";
export type Domain =
  | "identity"
  | "order"
  | "inventory"
  | "trade-in"
  | "buyback"
  | "warranty"
  | "refurbishment"
  | "financials"
  | "general";
export type Priority = "critical" | "high" | "medium" | "low";
export type Environment = "preprod" | "prod";
export type RunStatus = "running" | "success" | "failed" | "partial";
export type CaseStatus = "success" | "failed" | "skipped" | "running";
export type RunType = "smoke" | "regression" | "monkey" | "custom";

export interface TestStep {
  index: number;
  description: string;
  status: "pending" | "running" | "success" | "failed";
  durationMs?: number;
  timestamp: string;
}

export interface Anomaly {
  type: "console_error" | "http_error" | "outcome_mismatch" | "unexpected";
  message: string;
  screenshot?: string;
  timestamp: string;
}

export interface TestRun {
  id: string;
  name: string;
  environment: Environment;
  runType: RunType;
  status: RunStatus;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  startedAt: string;
  finishedAt?: string;
  triggeredBy: "manual" | "scheduled";
}

export interface CaseResult {
  id: string;
  runId: string;
  caseId: string;
  platform: Platform;
  status: CaseStatus;
  steps: TestStep[];
  anomalies: Anomaly[];
  errorMessage?: string;
  durationMs?: number;
  executedAt: string;
}

export interface SavedPrompt {
  id: string;
  title: string;
  prompt: string;
  platform: Platform;
  tags: Tag[];
  createdAt: string;
  lastRunAt?: string;
  runCount: number;
}

export interface WsMessage {
  type:
    | "step_update"
    | "case_start"
    | "case_end"
    | "run_end"
    | "anomaly"
    | "log"
    | "error"
    | "hub_status"
    | "plan_progress"
    | "screenshot_taken";
  payload: unknown;
}

export interface HubStatusPayload {
  connected: boolean;
  busy: boolean;
}

export interface JiraTaskMeta {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria?: string;
  prUrl?: string;
  branchHint?: string;
  comments?: string[];
}

export interface PrFileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  /** Raw unified diff patch for this file (first 3000 chars) */
  patch?: string;
}

export interface PrAnalysis {
  title: string;
  description: string;
  changedFiles: string[];
  /** Detailed per-file change info with patches */
  fileChanges: PrFileChange[];
  diffSummary: string;
  /** Concise human-readable summary of what the code actually changed */
  codeChangeSummary: string;
  triggerAction: string;
  prNumber?: number;
  prUrl?: string;
}

export interface ContextCache {
  domains: Record<string, string>;
  flows: Record<string, string>;
  selectors: Record<string, string>;
  /** Raw markdown TC documents keyed by filename (e.g. "TC-BB-001") */
  testCases: Record<string, string>;
  loadedAt: string;
}

export interface GeneratedTestCase {
  id: string;
  title: string;
  steps: string[];
  expected: string;
}

export interface GeneratedTestSuite {
  happy_paths: GeneratedTestCase[];
  edge_cases: GeneratedTestCase[];
  skip_reason: string[];
}

export interface PipelineOptions {
  taskKey: string;
  environment: Environment;
  runType?: RunType;
}
