import { NextRequest, NextResponse } from "next/server";
import { getLlmConfig } from "@/lib/mcp-bridge/hub-wrapper";

const BRIDGE_PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401", 10);

export async function GET(_req: NextRequest) {
  const llmCfg = getLlmConfig();

  // Query the bridge directly (npm run bridge process owns the WS connection)
  let connected = false;
  let busy = false;
  try {
    const res = await fetch(`http://localhost:${BRIDGE_PORT}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data = (await res.json()) as { connected: boolean; busy: boolean };
      connected = data.connected ?? false;
      busy = data.busy ?? false;
    }
  } catch {
    // bridge not running
  }

  return NextResponse.json({
    connected,
    busy,
    llm: llmCfg
      ? {
          baseURL: llmCfg.baseURL,
          model: llmCfg.model,
          apiKeySet: !!llmCfg.apiKey && !llmCfg.apiKey.includes("BURAYA"),
          compatible: true,
          warning: null,
        }
      : null,
  });
}
