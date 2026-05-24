/**
 * lib/jira-pipeline/llm-request.ts
 *
 * LLM provider-specific request body / header inşası için ortak yardımcılar.
 * OpenAI'nin yeni reasoning modelleri (gpt-5, o1, o3) eski parametreleri
 * reddediyor — bu modüldeki kontroller tek noktadan tutulur.
 */

/**
 * Model adı OpenAI'nin reasoning ailesinden mi?
 * Bu modeller `max_tokens` yerine `max_completion_tokens` ister ve
 * `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`
 * parametrelerini desteklemez.
 *
 * Örnekler: gpt-5, gpt-5.1, gpt-5-mini, o1, o1-mini, o3, o3-mini, o4-mini
 */
export function isOpenAiReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o1|o3|o4|o5)([-.]|$)/i.test(model);
}

/**
 * OpenAI Chat Completions request body'sini inşa eder.
 * Reasoning model'lerinde `max_tokens` → `max_completion_tokens` rename'i yapar.
 * Reasoning modelleri daha çok token "düşünmeye" ayırdığı için cap'i
 * mantıklı bir minimum'a yükseltir.
 */
export function buildOpenAiChatBody(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  stream?: boolean;
}): Record<string, unknown> {
  const { model, system, user, maxTokens, stream } = opts;
  const isReasoning = isOpenAiReasoningModel(model);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  if (isReasoning) {
    // Reasoning modelleri "thinking tokens" da harcadığı için minimum cap
    body.max_completion_tokens = Math.max(maxTokens, 2048);
  } else {
    body.max_tokens = maxTokens;
  }

  if (stream) body.stream = true;
  return body;
}
