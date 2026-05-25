import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "qa-agent.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      environment TEXT NOT NULL,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      total_cases INTEGER DEFAULT 0,
      passed_cases INTEGER DEFAULT 0,
      failed_cases INTEGER DEFAULT 0,
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      triggered_by TEXT NOT NULL DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS case_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      case_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      steps TEXT NOT NULL DEFAULT '[]',
      anomalies TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      duration_ms INTEGER,
      executed_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      platform TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME NOT NULL,
      last_run_at DATETIME,
      run_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_case_results_run_id ON case_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS risk_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_number INTEGER,
      jira_issue_key TEXT,
      risk_level TEXT,
      risk_score INTEGER,
      analysis_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_risk_analyses_pr ON risk_analyses(pr_number);

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      test_case_id TEXT NOT NULL,
      step_index INTEGER,
      file_path TEXT NOT NULL,
      label TEXT,
      taken_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_tc ON screenshots(test_case_id);

    CREATE TABLE IF NOT EXISTS jira_risk_summaries (
      jira_key TEXT NOT NULL,
      pr_number INTEGER,
      summary TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (jira_key, input_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_jira_risk_summaries_key ON jira_risk_summaries(jira_key);

    CREATE TABLE IF NOT EXISTS jira_task_iterations (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
      jira_key TEXT NOT NULL,
      iteration_index INTEGER NOT NULL,
      reopen_after BOOLEAN DEFAULT 0,
      reopen_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jira_task_iterations_key ON jira_task_iterations(jira_key);

    CREATE TABLE IF NOT EXISTS jira_qa_effort (
      jira_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      case_count INTEGER NOT NULL DEFAULT 0,
      total_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (jira_key, input_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_jira_qa_effort_key ON jira_qa_effort(jira_key);
  `);
}
