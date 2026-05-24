/**
 * Thin proxy to Anthropic's OpenAI-compatible endpoint.
 *
 * Reference: qa-agent-eniyisi/server/bridge.mjs — fixAnthropicCompat + handleLlmProxy
 *
 * Fixes applied:
 *   1. CORS headers  — chrome-extension:// origin needs Access-Control-*
 *   2. tool_choice   — page-agent sends Anthropic-native { type:'any' }, compat endpoint wants "required"
 *   3. thinking      — remove field, not supported on compat endpoint
 *   4. anthropic-version header — required by api.anthropic.com
 *   5. finish_reason — Anthropic returns "end_turn", page-agent expects "stop"
 */

import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_CHAT_URL = "https://api.anthropic.com/v1/chat/completions";
const ANTHROPIC_VERSION = "2023-06-01";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-api-key, anthropic-version",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/** Revert Anthropic-native patches that page-agent applies before calling the compat endpoint */
function fixAnthropicCompat(body: Record<string, unknown>): void {
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const tc = body.tool_choice as Record<string, unknown>;
    if (tc.type === "any") {
      // Anthropic native "any" → OpenAI "required"
      body.tool_choice = "required";
    } else if (tc.type === "tool" && tc.name) {
      body.tool_choice = { type: "function", function: { name: tc.name } };
    }
  }
  // thinking: { type: 'disabled' } is not valid on the compat endpoint
  delete body.thinking;
  // verbosity is a page-agent internal param some models reject
  delete body.verbosity;
}

function mapFinishReason(reason: string | null | undefined): string {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "max_tokens") return "length";
  return reason ?? "stop";
}

export async function POST(req: NextRequest) {
  // Resolve API key: Authorization header → x-api-key → server-side env fallback
  const auth = req.headers.get("authorization") ?? "";
  const xKey = req.headers.get("x-api-key") ?? "";
  const apiKey =
    auth.replace(/^Bearer\s+/i, "").trim() ||
    xKey.trim() ||
    process.env.LLM_API_KEY ||
    "";

  if (!apiKey) {
    return NextResponse.json(
      { error: { message: "API anahtarı eksik (Authorization: Bearer <key>)" } },
      { status: 401, headers: corsHeaders() }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Geçersiz JSON body" } },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Apply compat fixes (tool_choice, thinking, verbosity)
  fixAnthropicCompat(body);

  // Ensure a generous token budget so agent never hits premature end_turn
  if (!body.max_tokens) body.max_tokens = 8192;

  // Forward to Anthropic's OpenAI-compatible endpoint
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: `Anthropic API'ye ulaşılamadı: ${(err as Error).message}` } },
      { status: 502, headers: corsHeaders() }
    );
  }

  const ct = anthropicRes.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = (await anthropicRes.text()).slice(0, 300);
    console.error(`[proxy] Anthropic HTML yanıtı (${anthropicRes.status}):`, text);
    return NextResponse.json(
      { error: { message: `Anthropic HTML döndürdü (${anthropicRes.status}): ${text}` } },
      { status: anthropicRes.status, headers: corsHeaders() }
    );
  }

  const data = (await anthropicRes.json()) as Record<string, unknown>;

  if (!anthropicRes.ok) {
    console.error(`[proxy] Anthropic hata ${anthropicRes.status}:`, data);
    return NextResponse.json(data, { status: anthropicRes.status, headers: corsHeaders() });
  }

  // Map finish_reason in each choice (end_turn → stop)
  const choices = (data.choices as Array<Record<string, unknown>> | undefined) ?? [];
  for (const choice of choices) {
    if (choice.finish_reason !== undefined) {
      choice.finish_reason = mapFinishReason(choice.finish_reason as string);
    }
  }

  const model = (data.model as string) ?? (body.model as string) ?? "?";
  const fr = choices[0]?.finish_reason ?? "?";
  const usage = data.usage as Record<string, number> | undefined;
  console.log(
    `[proxy] OK model=${model} finish_reason=${fr}` +
      (usage ? ` tokens=${usage.prompt_tokens}in/${usage.completion_tokens}out` : "")
  );

  return NextResponse.json(data, { headers: corsHeaders() });
}
