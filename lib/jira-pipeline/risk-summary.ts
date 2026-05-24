/**
 * lib/jira-pipeline/risk-summary.ts
 *
 * Detay sayfasındaki "LLM Risk Özeti" panelini üreten yardımcı.
 *  - Prompt: JIRA özet + description + AC + PR diff özeti + reopen geçmişi
 *  - Çıktı: 2-4 cümlelik Türkçe paragraf (markdown yok, etiket yok)
 *  - Streaming destekli — chunk'ları doğrudan ReadableStream'e yazar
 *  - Aynı task + aynı input için sonuç DB'de cache'lenir
 */

import crypto from "crypto";
import { getLlmConfig } from "../mcp-bridge/hub-wrapper";
import { logLlmRequest, logInfo, logError } from "../logger";
import { buildOpenAiChatBody } from "./llm-request";
import type { JiraTaskMeta, PrAnalysis } from "../types";

export interface RiskSummaryInput {
  jira: JiraTaskMeta;
  pr: PrAnalysis | null;
  reopenCount: number;
  /** Reopen yapıldıysa, en güncel sebep (varsa) */
  lastReopenReason?: string | null;
  /** Etkilenen modül etiketleri */
  modules: string[];
}

const RISK_SUMMARY_SYSTEM = `Sen Getmobil platformunu bilen kıdemli bir QA mühendisisin.
Sana bir JIRA task ve ilgili GitHub PR diff özeti veriliyor.
Görevin: QA'in test öncesi bilmesi gereken risk noktalarını 2-4 cümlelik bir Türkçe paragraf olarak özetlemek.

KURALLAR:
- Açıklayıcı paragraf yaz, madde listesi kullanma
- Hangi servis/modüllerin etkilendiğini ve neden riskli olduğunu söyle
- Regresyon riski taşıyan alanları somut adlandır (örn. "iade akışında grade hesabı")
- Geçmişte reopen varsa bunu vurgula
- Maksimum 4 cümle, asla 80 kelimeyi geçme
- Markdown, başlık, emoji ya da etiket kullanma — düz Türkçe metin
- "Test edilmeli" yerine "regresyon riski taşır", "manuel kontrol önerilir" gibi spesifik ifadeler kullan
- Belirsiz dolgu cümlesi yazma ("dikkatli test edilmeli" tek başına yetmez)`;

function buildRiskSummaryPrompt(input: RiskSummaryInput): string {
  const { jira, pr, reopenCount, lastReopenReason, modules } = input;

  const prSection = pr
    ? `## PR Özeti
Başlık: ${pr.title}
Değişen dosya: ${pr.changedFiles.length}
Değişiklik özeti: ${pr.diffSummary.slice(0, 400)}
${pr.codeChangeSummary ? `Kod değişiklikleri:\n${pr.codeChangeSummary.slice(0, 1200)}` : ""}`
    : "## PR Özeti\nİlgili PR bulunamadı.";

  const modSection = modules.length > 0
    ? `Etkilenen modüller: ${modules.join(", ")}`
    : "Etkilenen modüller tespit edilemedi.";

  const historySection =
    reopenCount > 0
      ? `## Önceki QA Geçmişi
Bu task QA'den ${reopenCount} kez geri döndü.
${lastReopenReason ? `Son reopen sebebi: ${lastReopenReason.slice(0, 300)}` : ""}`
      : "## Önceki QA Geçmişi\nİlk QA iterasyonu.";

  return `## JIRA Task: ${jira.key}
Özet: ${jira.summary}
${jira.description ? `\nDescription:\n${jira.description.slice(0, 800)}` : ""}
${jira.acceptanceCriteria ? `\nKabul Kriterleri:\n${jira.acceptanceCriteria.slice(0, 500)}` : ""}

${prSection}

${modSection}

${historySection}

Yukarıdaki bilgilere dayanarak QA'in test öncesi bilmesi gereken risk noktalarını 2-4 cümlede özetle. Yalnızca paragrafı döndür.`;
}

export function computeRiskSummaryHash(input: RiskSummaryInput): string {
  const payload = JSON.stringify({
    summary: input.jira.summary,
    description: input.jira.description?.slice(0, 1000),
    acceptanceCriteria: input.jira.acceptanceCriteria?.slice(0, 500),
    prTitle: input.pr?.title,
    prFiles: input.pr?.changedFiles.sort(),
    reopenCount: input.reopenCount,
    modules: [...input.modules].sort(),
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Streaming yanıtı için: callback ile her metin chunk'ı geldiğinde
 * tetiklenir. Tüm metin döndükten sonra `fullText` resolve olur.
 */
export async function streamRiskSummary(
  input: RiskSummaryInput,
  onChunk: (chunk: string) => void
): Promise<string> {
  const llmConfig = getLlmConfig();
  if (!llmConfig) {
    throw new Error("LLM konfigürasyonu bulunamadı. .env.local dosyasını kontrol edin.");
  }

  const isAnthropic = llmConfig.baseURL.includes("anthropic");
  const provider = isAnthropic ? "anthropic" : "openai";
  const endpoint = isAnthropic
    ? `${llmConfig.baseURL.replace(/\/$/, "")}/messages`
    : `${llmConfig.baseURL.replace(/\/$/, "")}/chat/completions`;

  const prompt = buildRiskSummaryPrompt(input);

  const requestBody = isAnthropic
    ? {
        model: llmConfig.model,
        max_tokens: 600,
        system: RISK_SUMMARY_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }
    : buildOpenAiChatBody({
        model: llmConfig.model,
        system: RISK_SUMMARY_SYSTEM,
        user: prompt,
        maxTokens: 600,
        stream: true,
      });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${llmConfig.apiKey}`,
  };
  if (isAnthropic) {
    headers["x-api-key"] = llmConfig.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    delete headers["Authorization"];
  }

  const callStart = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok || !res.body) {
    const errBody = await res.text().catch(() => "");
    logError(
      `[risk-summary] LLM çağrısı başarısız: HTTP ${res.status} — ${errBody.slice(0, 200)}`,
      "jira-pipeline"
    );
    throw new Error(`LLM API hatası: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE chunk'ları "\n\n" ile ayrılır
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        for (const line of rawEvent.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const json = JSON.parse(data) as Record<string, unknown>;
            const chunkText = extractChunkText(json, isAnthropic);
            if (chunkText) {
              fullText += chunkText;
              onChunk(chunkText);
            }
          } catch {
            // chunk parse edilemezse atla
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  logLlmRequest({
    runId: "jira-pipeline",
    caseId: "risk-summary",
    provider,
    model: llmConfig.model,
    endpoint,
    requestBody,
    responseStatus: res.status,
    responseBody: { stream: true, fullText: fullText.slice(0, 500) },
    durationMs: Date.now() - callStart,
  });

  logInfo(
    `[risk-summary] ${input.jira.key} risk özeti üretildi (${fullText.length} karakter)`,
    "jira-pipeline"
  );

  return fullText.trim();
}

function extractChunkText(event: Record<string, unknown>, isAnthropic: boolean): string {
  if (isAnthropic) {
    // Anthropic: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
    const type = event.type as string | undefined;
    if (type === "content_block_delta") {
      const delta = event.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === "text_delta" && delta.text) return delta.text;
    }
    return "";
  }
  // OpenAI SSE: { choices: [{ delta: { content: "..." } }] }
  const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined;
  return choices?.[0]?.delta?.content ?? "";
}
