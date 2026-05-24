const PAGE_AGENT_PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401");

export interface TaskResult {
  success: boolean;
  data: string;
}

export interface HubStatus {
  connected: boolean;
  busy: boolean;
}

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  max_tokens?: number;
  /** Ollama native API için "/api/chat"; OpenAI-compatible için undefined */
  apiPath?: string;
}

/**
 * Probes the external bridge (npm run bridge) /status endpoint.
 */
export async function getBridgeStatus(): Promise<HubStatus> {
  try {
    const res = await fetch(`http://localhost:${PAGE_AGENT_PORT}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data = (await res.json()) as Partial<HubStatus>;
      return {
        connected: data.connected ?? false,
        busy: data.busy ?? false,
      };
    }
  } catch {
    // bridge not running — return disconnected state
  }
  return { connected: false, busy: false };
}

/**
 * Reads LLM config from env.
 * Priority:
 *   1. Legacy: LLM_BASE_URL + LLM_API_KEY + LLM_MODEL_NAME (backward compat)
 *   2. LLM_PROVIDER ile seçim: "openai" | "anthropic" | "ollama" | "bedrock"
 *      LLM_PROVIDER tanımsızsa varsayılan: "anthropic"
 * URL rewrite (api.anthropic.com → /anthropic-proxy) is handled by start-bridge.ts.
 */
export function getLlmConfig(): LlmConfig | undefined {
  // 1. Legacy env vars — highest priority for backward compatibility
  const legacyBase = process.env.LLM_BASE_URL;
  const legacyKey = process.env.LLM_API_KEY;
  const legacyModel = process.env.LLM_MODEL_NAME;

  if (legacyBase && legacyKey && legacyModel) {
    return { baseURL: legacyBase, apiKey: legacyKey, model: legacyModel, max_tokens: 8192 };
  }

  // 2. LLM_PROVIDER ile provider seç — otomatik algılama yok
  const provider = (process.env.LLM_PROVIDER?.trim() ?? "anthropic") as "anthropic" | "openai" | "ollama" | "ollama-local" | "bedrock";

  // bedrock: AWS Bedrock üzerinden Claude
  if (provider === "bedrock") {
    const region = process.env.AWS_BEDROCK_REGION ?? "us-east-1";
    const model = process.env.AWS_BEDROCK_MODEL_ID ?? "anthropic.claude-haiku-4-5-20251001-v1:0";
    // executor.ts "bedrock://" prefix'ini görünce bridge /bedrock-proxy'ye yönlendirir
    return {
      baseURL: `bedrock://${region}`,
      apiKey: process.env.AWS_ACCESS_KEY_ID ?? "bedrock",
      model,
      max_tokens: 8192,
    };
  }

  // ollama-local: localhost:11434, OpenAI-compat /v1, no auth
  if (provider === "ollama-local") {
    const baseURL = process.env.OLLAMA_LOCAL_BASE_URL ?? "http://localhost:11434";
    const model = process.env.OLLAMA_LOCAL_DEFAULT_MODEL ?? "llama3.2";
    const apiPath = process.env.OLLAMA_LOCAL_API_PATH ?? "/v1";
    return { baseURL, apiKey: "ollama", model, max_tokens: 8192, apiPath };
  }

  // ollama: remote/cloud Ollama instance
  if (provider === "ollama") {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const model = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.2";
    const apiKey = process.env.OLLAMA_API_KEY ?? "ollama";
    const apiPath = process.env.OLLAMA_API_PATH ?? "/api/chat";
    return { baseURL, apiKey, model, max_tokens: 8192, apiPath };
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return undefined;
    const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_DEFAULT_MODEL ?? "gpt-4o";
    return { baseURL, apiKey, model, max_tokens: 8192 };
  }

  // Default: anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1";
  const model = process.env.ANTHROPIC_DEFAULT_MODEL ?? "claude-haiku-4-5";
  if (!apiKey) return undefined;
  return { baseURL, apiKey, model, max_tokens: 8192 };
}
