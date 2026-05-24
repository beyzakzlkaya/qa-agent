/**
 * lib/test-engine/executeTestSuite.ts
 *
 * Page-Agent tabanlı test execution pipeline.
 * suiteToTestCases() çıktısını alır, mevcut bridge HTTP API'si üzerinden
 * PageAgent'ı çalıştırır, PASS/FAIL/SKIP sonuçlarını döner.
 *
 * Mevcut mimari: runner.ts → executor.ts → bridge HTTP (localhost:38401)
 * Bu modül aynı bridge HTTP endpoint'ini kullanır ama daha sade bir arayüz sunar.
 */

import type { TestCase } from "../types";
import { getLlmConfig } from "../mcp-bridge/hub-wrapper";

// ── LLM Config ──────────────────────────────────────────────────────────────

const LLM_CONFIG = {
  anthropic: {
    model: process.env.ANTHROPIC_DEFAULT_MODEL ?? "claude-haiku-4-5",
    baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  openai: {
    model: process.env.OPENAI_DEFAULT_MODEL ?? "gpt-4o",
    baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
  },
};

const BRIDGE_PORT = parseInt(process.env.PAGE_AGENT_PORT ?? "38401", 10);
const BRIDGE_BASE = `http://localhost:${BRIDGE_PORT}`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface TestResult {
  id: string;
  title: string;
  status: "PASS" | "FAIL" | "SKIP";
  durationMs: number;
  error?: string;
  agentOutput?: string;
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

interface DomElement {
  tag: string;
  text: string;
  id?: string;
  testId?: string;
  ariaLabel?: string;
  placeholder?: string;
  type?: string;
}

// ── Priority ordering ────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<TestCase["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── DOM Snapshot ─────────────────────────────────────────────────────────────

/**
 * Sayfadaki interaktif elementleri tarar ve JSON string döner.
 * Browser context'inde (evaluate) çalışmak üzere tasarlanmıştır.
 * Playwright kullanılıyorsa: page.evaluate(() => { ...fonksiyon gövdesi... })
 */
export async function captureDomSnapshot(): Promise<string> {
  // Bu fonksiyon browser evaluate context'inde çalışır
  const browserCapture = (): string => {
    const SELECTORS = [
      "button",
      "input",
      "select",
      "textarea",
      "a[href]",
      "[data-testid]",
      '[role="button"]',
    ].join(",");

    const MAX_TEXT = 50;
    const MAX_ELEMENTS = 100;

    const allNodes = Array.from(document.querySelectorAll(SELECTORS));

    const visible = allNodes.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const elements: DomElement[] = visible.slice(0, MAX_ELEMENTS).map((el) => {
      const rawText = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const entry: DomElement = {
        tag: el.tagName.toLowerCase(),
        text: rawText.slice(0, MAX_TEXT),
      };

      const id = el.getAttribute("id");
      if (id) entry.id = id;

      const testId = el.getAttribute("data-testid");
      if (testId) entry.testId = testId;

      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) entry.ariaLabel = ariaLabel;

      const placeholder = el.getAttribute("placeholder");
      if (placeholder) entry.placeholder = placeholder;

      const type = el.getAttribute("type");
      if (type) entry.type = type;

      return entry;
    });

    return JSON.stringify(elements, null, 2);
  };

  // Node.js ortamında çalışıyorsa (Playwright dışı) boş döner
  if (typeof document === "undefined") {
    return JSON.stringify([]);
  }

  return browserCapture();
}

// ── System Prompt Builder ────────────────────────────────────────────────────

export function buildSystemPrompt(domSnapshot: string, domainDocs: string[]): string {
  const docsSection = domainDocs
    .slice(0, 4)
    .map((doc, i) => `### Doküman ${i + 1}\n${doc}`)
    .join("\n\n");

  return `Sen bir QA otomasyon ajanısın. Sana bir test talimatı verilecek; browser üzerinde adımları uygula.

## Sayfadaki Mevcut Elementler (DOM Snapshot)
${domSnapshot}

## Domain Dokümanları (Referans)
${docsSection || "(doküman yok)"}

## Element Seçim Önceliği
1. data-testid attribute (en güvenilir)
2. aria-label attribute
3. Görünür text içeriği (buton/link metni)
4. placeholder attribute

## Yasak Selector'lar
- CSS class selector KULLANMA (.class gibi)
- ID selector KULLANMA (#id gibi)
- Yalnızca yukarıdaki öncelik sırasını kullan

## Doğrulama Kuralı
Tüm adımları tamamladıktan sonra:
- Beklenen sonuca ulaşıldıysa son satırda tam olarak şunu yaz: PASS
- Ulaşılamadıysa son satırda tam olarak şunu yaz: FAIL: <neden başarısız olduğunu açıkla>`;
}

// ── Instruction builder ──────────────────────────────────────────────────────

function buildTestInstruction(tc: TestCase): string {
  return `${tc.prompt}

Beklenen sonuç: ${tc.expectedOutcome}

Tüm adımları tamamladıktan sonra beklenen sonuca ulaşıldıysa son satırda PASS,
ulaşılamadıysa FAIL: <neden> yaz.`;
}

// ── PASS/FAIL parser ─────────────────────────────────────────────────────────

function parseAgentOutput(output: string): { status: "PASS" | "FAIL"; error?: string } {
  const lines = output.trim().split("\n");
  const lastLine = lines[lines.length - 1]?.trim() ?? "";

  if (/^PASS$/i.test(lastLine)) {
    return { status: "PASS" };
  }

  const failMatch = lastLine.match(/^FAIL:\s*(.+)$/i);
  if (failMatch) {
    return { status: "FAIL", error: failMatch[1]?.trim() };
  }

  // Son satırda net PASS/FAIL yoksa yalnızca son 3 satırda ara (tüm output'ta değil —
  // ara adım metinlerindeki "PASS" kelimeleri yanlış pozitif sonuca yol açar)
  const lastThreeLines = lines.slice(-3).join("\n");
  if (/\bPASS\b/i.test(lastThreeLines)) return { status: "PASS" };
  if (/\bFAIL\b/i.test(lastThreeLines)) {
    const match = lastThreeLines.match(/FAIL[:\s]+(.+)/i);
    return { status: "FAIL", error: match?.[1]?.trim() };
  }

  // Belirsiz çıktı → FAIL say
  return { status: "FAIL", error: "Agent çıktısında PASS veya FAIL bulunamadı" };
}

// ── Bridge health check ───────────────────────────────────────────────────────

async function isBridgeReady(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { connected?: boolean };
    return data.connected === true;
  } catch {
    return false;
  }
}

// ── Single test executor via bridge ──────────────────────────────────────────

async function runSingleTestViaBridge(
  tc: TestCase,
  systemPrompt: string,
  baseUrl: string,
  provider: "anthropic" | "openai",
): Promise<{ output: string; durationMs: number }> {
  const cfgOverride = LLM_CONFIG[provider];
  const llmConfig = getLlmConfig() ?? {
    model: cfgOverride.model,
    baseURL: cfgOverride.baseURL,
    apiKey: cfgOverride.apiKey,
    max_tokens: 8192,
  };

  const instruction = buildTestInstruction(tc);

  const payload = {
    task: `${systemPrompt}\n\n---\n\n${instruction}`,
    startUrl: baseUrl,
    runId: `exec-suite-${tc.id}`,
    caseId: tc.id,
    config: {
      apiKey: llmConfig.apiKey,
      baseURL: llmConfig.baseURL,
      model: llmConfig.model,
      maxSteps: 40,
      language: "en-US",
      max_tokens: (llmConfig as { max_tokens?: number }).max_tokens ?? 8192,
    },
  };

  const start = Date.now();

  const res = await fetch(`${BRIDGE_BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8 * 60 * 1000), // 8 dakika hard timeout
  });

  const durationMs = Date.now() - start;

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string;
      data?: string;
    };
    throw new Error(body.error ?? body.data ?? `Bridge HTTP ${res.status}`);
  }

  const result = (await res.json()) as { success?: boolean; data?: string; error?: string };
  const output = result.data ?? result.error ?? (result.success ? "PASS" : "FAIL: bridge success=false");

  return { output, durationMs };
}

// ── Ana export ────────────────────────────────────────────────────────────────

export async function executeTestSuite(options: {
  testCases: TestCase[];
  domainDocs: string[];
  baseUrl: string;
  provider?: "anthropic" | "openai";
  filterTags?: string[];
  filterPlatform?: string;
  onProgress?: (result: TestResult, index: number, total: number) => void;
}): Promise<{ results: TestResult[]; summary: Summary }> {
  const {
    testCases,
    domainDocs,
    baseUrl,
    provider = "anthropic",
    filterTags,
    filterPlatform,
    onProgress,
  } = options;

  // ── Filtreleme ──
  let filtered = [...testCases];

  if (filterPlatform) {
    filtered = filtered.filter((tc) =>
      tc.platform.includes(filterPlatform as TestCase["platform"][number])
    );
  }

  if (filterTags && filterTags.length > 0) {
    filtered = filtered.filter((tc) =>
      tc.tags.some((t) => filterTags.includes(t))
    );
  }

  // ── Priority sıralaması: critical → high → medium → low ──
  filtered.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const total = filtered.length;
  const results: TestResult[] = [];
  const suiteStart = Date.now();

  if (total === 0) {
    return {
      results: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    };
  }

  // ── Bridge hazır mı? ──
  const bridgeReady = await isBridgeReady();
  if (!bridgeReady) {
    const skippedResults: TestResult[] = filtered.map((tc) => ({
      id: tc.id,
      title: tc.title,
      status: "SKIP" as const,
      durationMs: 0,
      error:
        `Page Agent bridge'e bağlanılamadı (${BRIDGE_BASE}). ` +
        `"npm run bridge" çalışıyor mu ve Chrome extension aktif mi?`,
    }));
    const durationMs = Date.now() - suiteStart;
    return {
      results: skippedResults,
      summary: { total, passed: 0, failed: 0, skipped: total, durationMs },
    };
  }

  // ── DOM snapshot (Playwright context varsa page.evaluate ile override edilmeli) ──
  const domSnapshot = await captureDomSnapshot();
  const systemPrompt = buildSystemPrompt(domSnapshot, domainDocs);

  let skipRemaining = false;

  for (let i = 0; i < filtered.length; i++) {
    const tc = filtered[i]!;

    // Critical test fail olduktan sonra geride kalanları SKIP yap
    if (skipRemaining) {
      const skipResult: TestResult = {
        id: tc.id,
        title: tc.title,
        status: "SKIP",
        durationMs: 0,
        error: "Critical test başarısız olduğu için atlandı",
      };
      results.push(skipResult);
      onProgress?.(skipResult, i + 1, total);
      continue;
    }

    try {
      const { output, durationMs } = await runSingleTestViaBridge(
        tc,
        systemPrompt,
        baseUrl,
        provider,
      );

      const { status, error } = parseAgentOutput(output);

      const result: TestResult = {
        id: tc.id,
        title: tc.title,
        status,
        durationMs,
        agentOutput: output,
        ...(error ? { error } : {}),
      };

      results.push(result);
      onProgress?.(result, i + 1, total);

      // Critical test fail → geri kalanları SKIP'le
      if (status === "FAIL" && tc.priority === "critical") {
        skipRemaining = true;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      const result: TestResult = {
        id: tc.id,
        title: tc.title,
        status: "FAIL",
        durationMs: 0,
        error: errMsg,
      };

      results.push(result);
      onProgress?.(result, i + 1, total);

      if (tc.priority === "critical") {
        skipRemaining = true;
      }
    }
  }

  const durationMs = Date.now() - suiteStart;

  const summary: Summary = {
    total,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
    skipped: results.filter((r) => r.status === "SKIP").length,
    durationMs,
  };

  return { results, summary };
}
