/**
 * lib/jira-pipeline/qa-effort.ts
 *
 * Tahmini QA eforu hesaplama yardımcıları.
 *  - Input: JIRA task + GitHub PR + LLM ile üretilmiş test caseler + enrichment
 *  - LLM'den yapılandırılmış JSON çıktı ister (totalMinutes + breakdown + drivers)
 *  - Aynı task + aynı input için sonuç DB'de cache'lenir
 */

import crypto from "crypto";
import { getLlmConfig } from "../mcp-bridge/hub-wrapper";
import { logLlmRequest, logInfo, logError } from "../logger";
import { buildOpenAiChatBody } from "./llm-request";
import type { JiraTaskMeta, PrAnalysis, TestCase } from "../types";

export interface QaEffortBreakdown {
  setupMin: number;
  executionMin: number;
  regressionMin: number;
  exploratoryMin: number;
}

export interface QaEffortInput {
  jira: JiraTaskMeta;
  pr: PrAnalysis | null;
  cases: TestCase[];
  reopenCount: number;
  modules: string[];
}

export interface QaEffortResult {
  totalMinutes: number;
  breakdown: QaEffortBreakdown;
  confidence: "low" | "medium" | "high";
  drivers: string[];
  rationale: string;
  caseCount: number;
}

const QA_EFFORT_SYSTEM = `Sen Getmobil platformunda kıdemli bir QA mühendisisin.
Sana bir JIRA task, ilgili GitHub PR diff özeti ve LLM tarafından üretilmiş test case listesi veriliyor.
Görevin: Bu task için manuel QA tarafından harcanacak toplam efor için dakika cinsinden gerçekçi bir tahmin üretmek.

KURALLAR:
- Çıktı SADECE geçerli JSON olmalı, başka hiçbir metin / markdown / kod bloğu olmasın
- Tüm dakika değerleri integer olmalı; totalMinutes = setupMin + executionMin + regressionMin + exploratoryMin
- "setupMin": ortam hazırlığı, test data setup, login, fixtures
- "executionMin": üretilen test caselerinin manuel olarak adım adım koşulması
- "regressionMin": etkilenen modüllerin yakın çevresinde yapılacak ek regresyon
- "exploratoryMin": edge case ve keşifsel test süresi (reopen varsa daha yüksek olmalı)
- "confidence": "low" | "medium" | "high" — task içeriğinin / PR'ın netliğine göre
- "drivers": efor tahmini yukarı / aşağı çeken 2-5 somut maddenin Türkçe kısa açıklaması ("3 modül etkileniyor", "PR'da migration var")
- "rationale": 1-2 cümlelik Türkçe özet — neden bu efor tahmin edildi
- Realistik aralık: küçük bug fix ~15-30 dk, orta feature ~45-120 dk, büyük/multi-modül ~120-300 dk
- Reopen sayısı > 0 ise exploratoryMin'i artır
- Üretilmiş test case sayısı kadar 3-8 dk arası execution payı ekle

ŞEMA:
{
  "totalMinutes": <int>,
  "breakdown": {
    "setupMin": <int>,
    "executionMin": <int>,
    "regressionMin": <int>,
    "exploratoryMin": <int>
  },
  "confidence": "low" | "medium" | "high",
  "drivers": ["<madde 1>", "<madde 2>", ...],
  "rationale": "<1-2 cümle>"
}`;

function buildQaEffortPrompt(input: QaEffortInput): string {
  const { jira, pr, cases, reopenCount, modules } = input;

  const prSection = pr
    ? `## PR Özeti
Başlık: ${pr.title}
Değişen dosya sayısı: ${pr.changedFiles.length}
Diff özeti: ${pr.diffSummary.slice(0, 400)}
${pr.codeChangeSummary ? `Kod değişiklik özeti:\n${pr.codeChangeSummary.slice(0, 800)}` : ""}`
    : "## PR Özeti\nİlgili PR bulunamadı.";

  const modSection = modules.length > 0
    ? `Etkilenen modüller: ${modules.join(", ")}`
    : "Etkilenen modül tespit edilemedi.";

  const casesSection = cases.length === 0
    ? "## Üretilen Test Caseler\nHenüz test case üretilmedi."
    : `## Üretilen Test Caseler (${cases.length} adet)
${cases
  .slice(0, 25)
  .map(
    (c, i) =>
      `${i + 1}. [${c.priority}/${c.platform.join(",")}] ${c.title}` +
      (c.expectedOutcome ? `\n   Beklenen: ${c.expectedOutcome.slice(0, 120)}` : "")
  )
  .join("\n")}`;

  const historySection = reopenCount > 0
    ? `Önceki QA iterasyonu: Bu task QA'den ${reopenCount} kez geri döndü → exploratoryMin artmalı.`
    : "Önceki QA iterasyonu: İlk QA döngüsü.";

  return `## JIRA Task: ${jira.key}
Özet: ${jira.summary}
${jira.description ? `\nDescription:\n${jira.description.slice(0, 800)}` : ""}
${jira.acceptanceCriteria ? `\nKabul Kriterleri:\n${jira.acceptanceCriteria.slice(0, 500)}` : ""}

${prSection}

${modSection}

${casesSection}

${historySection}

Yukarıdaki bilgilere dayanarak QA için tahmini toplam eforu DAKİKA cinsinden hesapla. Şemada belirtilen JSON formatında yanıt ver.`;
}

export function computeQaEffortHash(input: QaEffortInput): string {
  const payload = JSON.stringify({
    summary: input.jira.summary,
    description: input.jira.description?.slice(0, 1000),
    acceptanceCriteria: input.jira.acceptanceCriteria?.slice(0, 500),
    prTitle: input.pr?.title,
    prFiles: input.pr?.changedFiles.sort(),
    reopenCount: input.reopenCount,
    modules: [...input.modules].sort(),
    caseIds: input.cases.map((c) => c.id).sort(),
    caseTitles: input.cases.map((c) => c.title).sort(),
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

interface RawLlmEffort {
  totalMinutes?: unknown;
  breakdown?: {
    setupMin?: unknown;
    executionMin?: unknown;
    regressionMin?: unknown;
    exploratoryMin?: unknown;
  };
  confidence?: unknown;
  drivers?: unknown;
  rationale?: unknown;
}

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function parseEffortResponse(raw: string, caseCount: number): QaEffortResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("LLM yanıtında JSON bulunamadı");
  }
  const jsonText = cleaned.slice(jsonStart, jsonEnd + 1);

  const parsed = JSON.parse(jsonText) as RawLlmEffort;

  const breakdown: QaEffortBreakdown = {
    setupMin: toInt(parsed.breakdown?.setupMin),
    executionMin: toInt(parsed.breakdown?.executionMin),
    regressionMin: toInt(parsed.breakdown?.regressionMin),
    exploratoryMin: toInt(parsed.breakdown?.exploratoryMin),
  };

  const sumFromBreakdown =
    breakdown.setupMin +
    breakdown.executionMin +
    breakdown.regressionMin +
    breakdown.exploratoryMin;

  const totalMinutes = toInt(parsed.totalMinutes, sumFromBreakdown) || sumFromBreakdown;

  const confidence =
    parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high"
      ? parsed.confidence
      : "medium";

  const drivers = Array.isArray(parsed.drivers)
    ? parsed.drivers
        .map((d) => String(d ?? "").trim())
        .filter((d) => d.length > 0)
        .slice(0, 6)
    : [];

  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";

  return {
    totalMinutes,
    breakdown,
    confidence,
    drivers,
    rationale,
    caseCount,
  };
}

export async function estimateQaEffort(input: QaEffortInput): Promise<QaEffortResult> {
  const llmConfig = getLlmConfig();
  if (!llmConfig) {
    throw new Error("LLM konfigürasyonu bulunamadı. .env.local dosyasını kontrol edin.");
  }

  const isAnthropic = llmConfig.baseURL.includes("anthropic");
  const provider = isAnthropic ? "anthropic" : "openai";
  const endpoint = isAnthropic
    ? `${llmConfig.baseURL.replace(/\/$/, "")}/messages`
    : `${llmConfig.baseURL.replace(/\/$/, "")}/chat/completions`;

  const prompt = buildQaEffortPrompt(input);

  const requestBody = isAnthropic
    ? {
        model: llmConfig.model,
        max_tokens: 700,
        system: QA_EFFORT_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }
    : buildOpenAiChatBody({
        model: llmConfig.model,
        system: QA_EFFORT_SYSTEM,
        user: prompt,
        maxTokens: 700,
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

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    logError(
      `[qa-effort] LLM çağrısı başarısız: HTTP ${res.status} — ${errBody.slice(0, 200)}`,
      "jira-pipeline"
    );
    throw new Error(`LLM API hatası: HTTP ${res.status}`);
  }

  const json = (await res.json()) as Record<string, unknown>;

  // Extract raw text from provider-specific shape
  let rawText = "";
  if (isAnthropic) {
    const content = json.content as Array<{ type?: string; text?: string }> | undefined;
    rawText = content?.find((c) => c.type === "text")?.text ?? "";
  } else {
    const choices = json.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    rawText = choices?.[0]?.message?.content ?? "";
  }

  if (!rawText.trim()) {
    throw new Error("LLM boş yanıt döndü");
  }

  logLlmRequest({
    runId: "jira-pipeline",
    caseId: "qa-effort",
    provider,
    model: llmConfig.model,
    endpoint,
    requestBody,
    responseStatus: res.status,
    responseBody: { snippet: rawText.slice(0, 500) },
    durationMs: Date.now() - callStart,
  });

  const result = parseEffortResponse(rawText, input.cases.length);

  logInfo(
    `[qa-effort] ${input.jira.key}: ${result.totalMinutes}dk tahmin (${result.confidence} confidence, ${result.caseCount} case)`,
    "jira-pipeline"
  );

  return result;
}
