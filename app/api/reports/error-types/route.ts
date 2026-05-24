import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export interface ErrorTypeBucket {
  type: "UI / Element" | "API / Backend" | "Veri / Setup" | "Timeout / Performans" | "Diğer";
  count: number;
  owner: "FE" | "BE" | "QA" | "DevOps" | "—";
}

function classify(message: string): ErrorTypeBucket["type"] {
  const m = message ?? "";
  if (!m) return "Diğer";
  if (
    /NoSuchElement/i.test(m) ||
    /element\s+not\s+found/i.test(m) ||
    /locator/i.test(m) ||
    /selector/i.test(m) ||
    /could\s+not\s+find/i.test(m) ||
    /not\s+visible/i.test(m) ||
    /ElementNotInteractable/i.test(m)
  ) {
    return "UI / Element";
  }
  if (
    /HTTP\s*[45]\d{2}/i.test(m) ||
    /status\s*[:=]\s*[45]\d{2}/i.test(m) ||
    /500|502|503|504/.test(m) ||
    /backend/i.test(m) ||
    /api\s+error/i.test(m) ||
    /response/i.test(m)
  ) {
    return "API / Backend";
  }
  if (/timeout/i.test(m) || /timed\s+out/i.test(m) || /exceeded\s+\d+\s*ms/i.test(m)) {
    return "Timeout / Performans";
  }
  if (
    /fixture/i.test(m) ||
    /seed/i.test(m) ||
    /database/i.test(m) ||
    /db\s+error/i.test(m) ||
    /sql/i.test(m) ||
    /missing\s+(data|user|account)/i.test(m)
  ) {
    return "Veri / Setup";
  }
  return "Diğer";
}

const OWNER_BY_TYPE: Record<ErrorTypeBucket["type"], ErrorTypeBucket["owner"]> = {
  "UI / Element": "FE",
  "API / Backend": "BE",
  "Veri / Setup": "QA",
  "Timeout / Performans": "DevOps",
  "Diğer": "—",
};

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

    const counts: Record<ErrorTypeBucket["type"], number> = {
      "UI / Element": 0,
      "API / Backend": 0,
      "Veri / Setup": 0,
      "Timeout / Performans": 0,
      "Diğer": 0,
    };

    for (const r of rows) {
      counts[classify(r.error_message)]++;
    }

    const buckets: ErrorTypeBucket[] = (
      Object.entries(counts) as [ErrorTypeBucket["type"], number][]
    ).map(([type, count]) => ({
      type,
      count,
      owner: OWNER_BY_TYPE[type],
    }));

    return NextResponse.json({ buckets, total: rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
