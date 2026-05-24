import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") ?? "50");
    const offset = parseInt(searchParams.get("offset") ?? "0");
    const runs = listRuns(limit, offset).map((r) => {
      const startMs = Date.parse(r.startedAt);
      const endMs = r.finishedAt ? Date.parse(r.finishedAt) : NaN;
      const durationMs =
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
          ? endMs - startMs
          : undefined;
      return { ...r, durationMs };
    });
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
