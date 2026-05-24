import { NextRequest, NextResponse } from "next/server";
import { broadcastGlobal } from "@/server/ws-handler";

export async function POST(req: NextRequest) {
  const { connected, busy } = (await req.json()) as {
    connected: boolean;
    busy: boolean;
  };

  broadcastGlobal({ type: "hub_status", payload: { connected, busy } });

  return NextResponse.json({ ok: true });
}
