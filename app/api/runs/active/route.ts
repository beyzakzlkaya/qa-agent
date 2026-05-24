import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export interface ActiveRunInfo {
  id: string;
  name: string;
  environment: string;
  startedAt: string;
}

export interface ActiveRunsResp {
  running: ActiveRunInfo[];
  queued: ActiveRunInfo[];
}

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, environment, status, started_at
         FROM runs
         WHERE status = 'running'
         ORDER BY started_at DESC
         LIMIT 50`
      )
      .all() as {
        id: string;
        name: string;
        environment: string;
        status: string;
        started_at: string;
      }[];

    const running: ActiveRunInfo[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      environment: r.environment,
      startedAt: r.started_at,
    }));

    return NextResponse.json({ running, queued: [] as ActiveRunInfo[] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
