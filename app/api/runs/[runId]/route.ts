import { NextRequest, NextResponse } from "next/server";
import { getRun, getCaseResultsByRun } from "@/lib/db/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const run = getRun(params.runId);
    if (!run) {
      return NextResponse.json({ error: "Run bulunamadı" }, { status: 404 });
    }
    const caseResults = getCaseResultsByRun(params.runId);
    return NextResponse.json({ run, caseResults });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
