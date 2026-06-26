import { NextResponse } from "next/server";
import { getModuleMetrics } from "@/lib/reports/module-metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? "30");
    const modules = getModuleMetrics(Number.isFinite(days) && days > 0 ? days : 30);
    return NextResponse.json({ modules, windowDays: days });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
