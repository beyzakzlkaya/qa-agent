/**
 * GET /api/jira/previous-iterations/[key]
 *
 * Bu JIRA task'ı için daha önce yerel sistemde koşulmuş test run'larını
 * (iterasyonları) döner. Her iterasyon için:
 *  - run id + tarih
 *  - geçen/kalan test sayısı
 *  - hangi case'lerin fail olduğu (kısa özet)
 *  - reopen olup olmadığı (JIRA changelog'tan)
 *
 * Detay sayfasındaki "Önceki QA İterasyonları" kartı bunu kullanır.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getJiraIterations } from "@/lib/db/queries";
import type { TestRun, CaseResult } from "@/lib/types";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

export interface PreviousIterationFailedCase {
  caseId: string;
  errorMessage: string | null;
  /** İlk anomaly'nin mesajı — varsa */
  anomalyHint: string | null;
}

export interface PreviousIteration {
  runId: string;
  iterationIndex: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  /** Bu iterasyondan sonra task reopen edildi mi (JIRA changelog'a göre) */
  reopenedAfter: boolean;
  /** Reopen sebebi — son JIRA comment'ından heuristic */
  reopenReason: string | null;
  /** Fail olan case'lerin kısa özetleri */
  failedDetails: PreviousIterationFailedCase[];
}

export interface PreviousIterationsResp {
  taskKey: string;
  iterations: PreviousIteration[];
  available: boolean;
}

interface RunRow {
  id: string;
  name: string;
  environment: string;
  run_type: string;
  status: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
}

interface FailedCaseRow {
  case_id: string;
  error_message: string | null;
  anomalies: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params;
  const key = rawKey.trim().toUpperCase();
  if (!TASK_KEY_REGEX.test(key)) {
    return NextResponse.json({ error: "Geçersiz task numarası" }, { status: 400 });
  }

  try {
    const db = getDb();
    const linkedRuns = getJiraIterations(key);

    // Hiç iterasyon yoksa runs.name'i fallback olarak arayalım
    let runIds = linkedRuns.map((r) => r.run_id);
    if (runIds.length === 0) {
      const fallback = db
        .prepare(
          `SELECT id FROM runs WHERE name LIKE ? ORDER BY started_at ASC`
        )
        .all(`%${key}%`) as { id: string }[];
      runIds = fallback.map((r) => r.id);
    }

    if (runIds.length === 0) {
      return NextResponse.json({
        taskKey: key,
        iterations: [],
        available: true,
      } as PreviousIterationsResp);
    }

    const placeholders = runIds.map(() => "?").join(",");
    const runRows = db
      .prepare(`SELECT * FROM runs WHERE id IN (${placeholders}) ORDER BY started_at ASC`)
      .all(...runIds) as RunRow[];

    const iterations: PreviousIteration[] = runRows.map((row, idx) => {
      const failedRows = db
        .prepare(
          `SELECT case_id, error_message, anomalies FROM case_results
           WHERE run_id = ? AND status = 'failed' ORDER BY executed_at ASC LIMIT 8`
        )
        .all(row.id) as FailedCaseRow[];

      const failedDetails: PreviousIterationFailedCase[] = failedRows.map((f) => {
        let anomalyHint: string | null = null;
        try {
          const anomalies = JSON.parse(f.anomalies) as Array<{ message?: string }>;
          if (anomalies.length > 0 && anomalies[0].message) {
            anomalyHint = anomalies[0].message.slice(0, 160);
          }
        } catch {
          // ignore
        }
        return {
          caseId: f.case_id,
          errorMessage: f.error_message ? f.error_message.slice(0, 200) : null,
          anomalyHint,
        };
      });

      const linked = linkedRuns.find((l) => l.run_id === row.id);

      return {
        runId: row.id,
        iterationIndex: linked?.iteration_index ?? idx + 1,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        status: row.status,
        totalCases: row.total_cases,
        passedCases: row.passed_cases,
        failedCases: row.failed_cases,
        reopenedAfter: linked?.reopen_after === 1,
        reopenReason: linked?.reopen_reason ?? null,
        failedDetails,
      };
    });

    return NextResponse.json({
      taskKey: key,
      iterations,
      available: true,
    } as PreviousIterationsResp);
  } catch (err) {
    console.error(`[api/jira/previous-iterations/${key}]`, err);
    return NextResponse.json(
      { error: (err as Error).message ?? "İterasyon geçmişi alınamadı" },
      { status: 500 }
    );
  }
}
