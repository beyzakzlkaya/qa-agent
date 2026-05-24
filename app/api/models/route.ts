/**
 * OpenAI-compat /v1/models stub — used by validateLlmConfig() and the
 * Chrome extension to check the endpoint is alive.
 */
import { NextResponse } from "next/server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    {
      object: "list",
      data: [
        { id: "claude-haiku-4-5-20251001", object: "model", owned_by: "anthropic" },
        { id: "claude-sonnet-4-5-20250929", object: "model", owned_by: "anthropic" },
      ],
    },
    { headers: CORS }
  );
}
