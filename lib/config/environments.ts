if (!process.env.ANTHROPIC_API_KEY && typeof window === "undefined") {
  console.error('[CONFIG] ANTHROPIC_API_KEY tanımlı değil — .env.local dosyasını kontrol et');
}

export const ENVIRONMENTS = {
  preprod: {
    backoffice: "https://preprod-backoffice.getmobil.com/",
    partner: "https://preprod-partner.getmobil.com/",
    website: "https://preprod.getmobil.com/",
  },
  prod: {
    backoffice: "https://backoffice.getmobil.com/",
    partner: "https://partner.getmobil.com/",
    website: "https://www.getmobil.com/",
  },
} as const;

export type Environment = keyof typeof ENVIRONMENTS;
export type Platform = "backoffice" | "partner" | "website";

export function getUrl(env: Environment, platform: Platform): string {
  return ENVIRONMENTS[env][platform];
}

// Alias for explicit AppEnvironment naming
export type AppEnvironment = Environment;
export const TARGET_URLS = ENVIRONMENTS;
export function getTargetUrl(platform: Platform, env: AppEnvironment): string {
  return ENVIRONMENTS[env][platform];
}

// ── Multi-Provider LLM ────────────────────────────────────────────────────────

export type LlmProvider = "anthropic" | "openai";

export interface ProviderConfig {
  id: LlmProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export const PROVIDERS: Record<LlmProvider, ProviderConfig> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
};

export const AVAILABLE_MODELS: Record<LlmProvider, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
};
