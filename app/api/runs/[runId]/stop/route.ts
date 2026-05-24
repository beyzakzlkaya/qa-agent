import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRunStatus } from "@/lib/db/queries";
import { abortRun } from "@/lib/test-engine/runner";

const BRIDGE_PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401", 10);
const BRIDGE_BASE = `http://localhost:${BRIDGE_PORT}`;

export async function POST(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const run = getRun(params.runId);
    if (!run) {
      return NextResponse.json({ error: "Run bulunamadı" }, { status: 404 });
    }

    if (run.status !== "running") {
      return NextResponse.json({ ok: true, message: "Run zaten tamamlanmış" });
    }

    // 1. Signal runner to stop processing
    abortRun(params.runId);

    // 2. Signal bridge to stop page-agent
    try {
      await fetch(`${BRIDGE_BASE}/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Bridge might not be running — ignore
    }

    // Note: run status is updated by runCasesAsync once it sees the abort signal.
    // We only do a fallback update here if the runner never picked it up.
    const refreshed = getRun(params.runId);
    if (refreshed?.status === "running") {
      updateRunStatus(params.runId, "failed", refreshed.passedCases, refreshed.failedCases, new Date().toISOString());
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
