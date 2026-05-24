/**
 * lib/risk-analyzer/analyzer.ts
 *
 * Analyzes a PR diff using Claude LLM and domain context to produce
 * a structured RiskAnalysis with affected screens, regression risks,
 * and suggested test scenarios.
 */

import { buildDomainContext } from "../domain-agent/context-builder";
import { getLlmConfig } from "../mcp-bridge/hub-wrapper";
import type { PRDiff, RiskAnalysis, SuggestedScenario } from "./types";

const MAX_RETRIES = 2;

function buildAnalysisPrompt(prDiff: PRDiff, domainContext: string): string {
  const filesList = prDiff.changedFiles
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`
    )
    .join("\n");

  const patches = prDiff.changedFiles
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n")
    .slice(0, 8000);

  const domainSection = domainContext
    ? `\n\n${domainContext}\n\n`
    : "";

  return `Sen bir QA mühendisisin. Aşağıdaki GitHub PR değişikliklerini analiz et.

PR Başlığı: ${prDiff.title}
PR Açıklaması: ${prDiff.description || "(yok)"}

Değişen Dosyalar:
${filesList}

Patch İçerikleri:
${patches || "(patch alınamadı)"}
${domainSection}
Şu JSON formatında yanıt ver (başka hiçbir şey yazma, sadece JSON):
{
  "riskLevel": "low" | "medium" | "high" | "critical",
  "riskScore": 0-100,
  "riskReasons": ["neden1", "neden2"],
  "affectedScreens": ["screen1", "screen2"],
  "affectedServices": ["service1"],
  "regressionRisk": ["hangi mevcut özellikler bozulabilir"],
  "newFeaturesDetected": ["yeni özellik açıklaması"],
  "prioritizedTestAreas": ["en önce test edilmesi gereken alan"],
  "suggestedTestCaseIds": [],
  "suggestedNewTestScenarios": [
    {
      "title": "senaryo başlığı",
      "description": "ne test edilmeli",
      "priority": "high" | "medium" | "low",
      "targetScreen": "backoffice" | "partner" | "website"
    }
  ]
}`;
}

function parseRiskResponse(raw: string): Omit<RiskAnalysis, "prNumber" | "analyzedAt"> {
  // Extract JSON block (handle markdown code fences)
  const jsonMatch =
    raw.match(/```(?:json)?\s*([\s\S]*?)```/) ??
    raw.match(/(\{[\s\S]*\})/);

  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
  const parsed = JSON.parse(jsonStr) as Partial<RiskAnalysis>;

  return {
    riskLevel: (["low", "medium", "high", "critical"].includes(
      parsed.riskLevel ?? ""
    )
      ? parsed.riskLevel
      : "medium") as RiskAnalysis["riskLevel"],
    riskScore: Math.min(100, Math.max(0, Number(parsed.riskScore ?? 50))),
    riskReasons: Array.isArray(parsed.riskReasons) ? parsed.riskReasons : [],
    affectedScreens: Array.isArray(parsed.affectedScreens)
      ? parsed.affectedScreens
      : [],
    affectedServices: Array.isArray(parsed.affectedServices)
      ? parsed.affectedServices
      : [],
    regressionRisk: Array.isArray(parsed.regressionRisk)
      ? parsed.regressionRisk
      : [],
    newFeaturesDetected: Array.isArray(parsed.newFeaturesDetected)
      ? parsed.newFeaturesDetected
      : [],
    prioritizedTestAreas: Array.isArray(parsed.prioritizedTestAreas)
      ? parsed.prioritizedTestAreas
      : [],
    suggestedTestCaseIds: Array.isArray(parsed.suggestedTestCaseIds)
      ? parsed.suggestedTestCaseIds
      : [],
    suggestedNewTestScenarios: Array.isArray(parsed.suggestedNewTestScenarios)
      ? (parsed.suggestedNewTestScenarios as SuggestedScenario[])
      : [],
  };
}

async function callLlm(prompt: string): Promise<string> {
  const config = getLlmConfig();
  if (!config) throw new Error("LLM konfigürasyonu bulunamadı");

  const isOllamaNative = config.apiPath === "/api/chat";
  // Anthropic native API; Ollama + OpenAI her ikisi de OpenAI-compatible endpoint kullanır
  const isAnthropic = config.baseURL.includes("anthropic");

  let endpoint: string;
  let body: Record<string, unknown>;
  let headers: Record<string, string>;

  if (isOllamaNative) {
    endpoint = `${config.baseURL}/api/chat`;
    body = {
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    };
    headers = {
      "Content-Type": "application/json",
      ...(config.apiKey && config.apiKey !== "ollama" ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  } else if (isAnthropic) {
    endpoint = `${config.baseURL}/messages`;
    body = { model: config.model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] };
    headers = {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  } else {
    endpoint = `${config.baseURL}/chat/completions`;
    body = { model: config.model, messages: [{ role: "user", content: prompt }], max_tokens: 2048 };
    headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM API hatası: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    message?: { content: string };
    content?: { text: string }[];
    choices?: { message: { content: string } }[];
  };

  if (isOllamaNative) return data.message?.content ?? "";
  if (isAnthropic) return data.content?.[0]?.text ?? "";
  return data.choices?.[0]?.message?.content ?? "";
}

export async function analyzeRisk(prDiff: PRDiff): Promise<RiskAnalysis> {
  console.log(
    `[risk-analyzer] PR #${prDiff.prNumber} analiz ediliyor: "${prDiff.title}"`
  );

  const domainContext = await buildDomainContext(
    `${prDiff.title} ${prDiff.description}`
  ).catch(() => "");

  const prompt = buildAnalysisPrompt(prDiff, domainContext);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await callLlm(prompt);
      const parsed = parseRiskResponse(raw);

      return {
        ...parsed,
        prNumber: prDiff.prNumber,
        analyzedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err as Error;
      console.warn(
        `[risk-analyzer] Deneme ${attempt}/${MAX_RETRIES} başarısız: ${lastError.message}`
      );
    }
  }

  // Return a safe fallback after all retries exhausted
  console.error(
    `[risk-analyzer] Tüm denemeler başarısız: ${lastError?.message}`
  );
  return {
    riskLevel: "medium",
    riskScore: 50,
    riskReasons: ["Analiz tamamlanamadı — LLM yanıt ayrıştırılamadı"],
    affectedScreens: [],
    affectedServices: [],
    regressionRisk: [],
    newFeaturesDetected: [],
    prioritizedTestAreas: [],
    suggestedTestCaseIds: [],
    suggestedNewTestScenarios: [],
    prNumber: prDiff.prNumber,
    analyzedAt: new Date().toISOString(),
  };
}
