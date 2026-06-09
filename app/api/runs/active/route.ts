import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getBridgeQueueSnapshot,
  getActiveRunIds,
} from "@/lib/test-engine/runner";

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
         ORDER BY started_at ASC
         LIMIT 50`
      )
      .all() as {
        id: string;
        name: string;
        environment: string;
        status: string;
        started_at: string;
      }[];

    // Bridge tek-tenant olduğundan aynı anda sadece 1 run "çalışıyor".
    // Diğerleri ya bridge için bekliyor ya da runner cases arası geçişte.
    // Zombi DB satırlarını (process restart sonrası kalan) hariç tutmak için
    // sadece runner'ın şu an takip ettiği runları gösteriyoruz.
    const activeRunIds = getActiveRunIds();
    const liveRows = rows.filter((r) => activeRunIds.has(r.id));

    const bridgeQueue = getBridgeQueueSnapshot();
    const activeAtBridge = bridgeQueue[0] ?? null;

    // Bridge bir an boşsa (cases arası mikro-an) en eski live run "running"
    // sayılır, flicker olmasın diye.
    const fallbackActive =
      !activeAtBridge && liveRows.length > 0 ? liveRows[0].id : null;
    const effectiveActive = activeAtBridge ?? fallbackActive;

    const running: ActiveRunInfo[] = [];
    const queued: ActiveRunInfo[] = [];

    for (const r of liveRows) {
      const info: ActiveRunInfo = {
        id: r.id,
        name: r.name,
        environment: r.environment,
        startedAt: r.started_at,
      };
      if (r.id === effectiveActive) {
        running.push(info);
      } else {
        queued.push(info);
      }
    }

    return NextResponse.json({ running, queued } satisfies ActiveRunsResp);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
