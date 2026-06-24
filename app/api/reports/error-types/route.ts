import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  bucketsFromCounts,
  classifyErrorMessage,
  emptyErrorTypeCounts,
  type ErrorTypeBucket,
} from "@/lib/reports/error-types";

export type { ErrorTypeBucket };

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT error_message
         FROM case_results
         WHERE status = 'failed'
           AND error_message IS NOT NULL
           AND error_message != ''
           AND executed_at > datetime('now', '-30 days')`
      )
      .all() as { error_message: string }[];

    const counts = emptyErrorTypeCounts();
    for (const r of rows) {
      counts[classifyErrorMessage(r.error_message)]++;
    }

    return NextResponse.json({ buckets: bucketsFromCounts(counts), total: rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
