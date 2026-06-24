import { NextRequest, NextResponse } from "next/server";
import { buildRunSummary } from "@/lib/reports/run-summary";

export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const summary = buildRunSummary(params.runId);
    if (!summary) {
      return NextResponse.json({ error: "Run bulunamadı" }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
