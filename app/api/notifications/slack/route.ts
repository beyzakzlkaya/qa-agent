import { NextRequest, NextResponse } from "next/server";
import { postRunSummaryToSlack } from "@/lib/notifications/slack";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const webhookUrl =
      typeof body?.webhookUrl === "string" && body.webhookUrl.trim().length > 0
        ? body.webhookUrl.trim()
        : undefined;

    if (!runId) {
      return NextResponse.json(
        { error: "runId zorunludur" },
        { status: 400 }
      );
    }

    const result = await postRunSummaryToSlack(runId, { webhookUrl });

    if (result.skipped) {
      return NextResponse.json(result, { status: 422 });
    }
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
