/**
 * lib/tc-planner/generator.ts
 *
 * Generates new test cases from suggested scenarios using LLM + domain context.
 */

import fs from "fs";
import path from "path";
import { getLlmConfig } from "../mcp-bridge/hub-wrapper";
import { buildDomainContext } from "../domain-agent/context-builder";
import type { SuggestedScenario } from "./types";
import type { TestCase } from "../types";

const CASES_DIR = path.join(process.cwd(), "data", "test-cases");

function buildGenerationPrompt(
  scenario: SuggestedScenario,
  domainContext: string
): string {
  const domainSection = domainContext
    ? `\n\n${domainContext}\n\n`
    : "";

  return `Sen bir QA mühendisisin. Aşağıdaki senaryo için JSON formatında bir test case oluştur.
${domainSection}
Senaryo:
- Başlık: ${scenario.title}
- Açıklama: ${scenario.description}
- Öncelik: ${scenario.priority}
- Hedef Ekran: ${scenario.targetScreen}

Şu JSON formatında yanıt ver (başka hiçbir şey yazma):
{
  "id": "(otomatik oluşturulacak)",
  "title": "${scenario.title}",
  "platform": ["${scenario.targetScreen}"],
  "tags": ["regression"],
  "priority": "${scenario.priority}",
  "domain": "general",
  "prompt": "Adım adım browser otomasyon testi talimatları...",
  "expectedOutcome": "Test sonunda beklenen durum"
}`;
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
    body = { model: config.model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] };
    headers = {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  } else {
    endpoint = `${config.baseURL}/chat/completions`;
    body = { model: config.model, messages: [{ role: "user", content: prompt }], max_tokens: 1024 };
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

let _genIndex = 0;

export async function generateTestCase(
  scenario: SuggestedScenario
): Promise<TestCase> {
  const domainContext = await buildDomainContext(
    `${scenario.title} ${scenario.description}`
  ).catch(() => "");

  const prompt = buildGenerationPrompt(scenario, domainContext);
  const raw = await callLlm(prompt);

  // Extract JSON
  const jsonMatch =
    raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  const parsed = JSON.parse(jsonStr) as Partial<TestCase>;
  const id = `GEN-${Date.now()}-${++_genIndex}`;

  const tc: TestCase = {
    id,
    title: parsed.title ?? scenario.title,
    platform: (parsed.platform ?? [scenario.targetScreen]) as TestCase["platform"],
    tags: (parsed.tags ?? ["regression"]) as TestCase["tags"],
    priority: (parsed.priority ?? scenario.priority) as TestCase["priority"],
    domain: (parsed.domain ?? "general") as TestCase["domain"],
    prompt: parsed.prompt ?? scenario.description,
    expectedOutcome:
      parsed.expectedOutcome ?? "Test başarıyla tamamlanmalı",
  };

  // Save to data/test-cases/{targetScreen}/generated/
  const dir = path.join(CASES_DIR, scenario.targetScreen, "generated");
  fs.mkdirSync(dir, { recursive: true });

  const existingFile = path.join(dir, "generated.json");
  let existing: TestCase[] = [];
  if (fs.existsSync(existingFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(existingFile, "utf-8")) as TestCase[];
    } catch {
      existing = [];
    }
  }

  existing.push(tc);
  fs.writeFileSync(existingFile, JSON.stringify(existing, null, 2), "utf-8");

  console.log(`[tc-planner] Yeni TC oluşturuldu: ${id} → ${existingFile}`);
  return tc;
}
