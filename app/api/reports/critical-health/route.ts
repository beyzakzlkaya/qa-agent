import { NextResponse } from "next/server";
import { getPriorityHealth } from "@/lib/reports/module-metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? "7");
    const rows = getPriorityHealth(["critical", "high"], Number.isFinite(days) && days > 0 ? days : 7);
    return NextResponse.json({ rows, windowDays: days });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
