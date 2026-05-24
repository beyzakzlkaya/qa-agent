#!/usr/bin/env ts-node
/**
 * scripts/mcp-server.ts
 *
 * QA Agent — Embedded MCP Server (stdio transport)
 *
 * Bu server, PageAgent bridge'i (scripts/start-bridge.ts) aracılığıyla
 * test case'lerinizi doğrudan MCP araçları olarak Claude / Cursor'dan
 * çalıştırmanızı sağlar.
 *
 * Araçlar:
 *   list_test_cases  — Tüm test case'leri veya filtrelenmiş listeyi döner
 *   get_bridge_status — Bridge ve Chrome Extension bağlantı durumu
 *   run_test_case    — Tek bir test case'i ID ile çalıştırır
 *   run_test_suite   — Platform/tag filtresiyle suite çalıştırır
 *   stop_test        — Çalışan testi durdurur
 *
 * Kullanım:
 *   npm run mcp-server
 *
 * Önkoşullar:
 *   1. npm run bridge   (ayrı terminalde — port 38401)
 *   2. Chrome'da Page Agent Extension aktif
 *   3. .env.local doğru yapılandırılmış
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── .env.local yükleme ─────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Imports (env yüklendikten sonra) ─────────────────────────────────────────
import type { TestCase, Platform, Tag } from "../lib/types";
import { loadAllCases, loadTestCases, loadCasesByIds } from "../lib/test-engine/parser";
import { getLlmConfig } from "../lib/mcp-bridge/hub-wrapper";

// ── Sabitler ──────────────────────────────────────────────────────────────────
const BRIDGE_PORT = parseInt(process.env.PAGE_AGENT_PORT ?? "38401", 10);
const BRIDGE_BASE = `http://localhost:${BRIDGE_PORT}`;

const PRIORITY_ORDER: Record<TestCase["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── Bridge yardımcıları ────────────────────────────────────────────────────────

async function checkBridgeStatus(): Promise<{ connected: boolean; busy: boolean; error?: string }> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { connected: false, busy: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { connected?: boolean; busy?: boolean };
    return { connected: data.connected ?? false, busy: data.busy ?? false };
  } catch (err) {
    return {
      connected: false,
      busy: false,
      error: `Bridge'e ulaşılamadı (${BRIDGE_BASE}). "npm run bridge" çalışıyor mu?`,
    };
  }
}

async function executeViaBridge(
  task: string,
  startUrl: string,
  runId: string,
  caseId: string
): Promise<{ success: boolean; data: string }> {
  const llmConfig = getLlmConfig();
  if (!llmConfig) {
    throw new Error(
      ".env.local dosyasında LLM yapılandırması eksik.\n" +
        "ANTHROPIC_API_KEY veya OPENAI_API_KEY değerini ayarlayın."
    );
  }

  const payload = {
    task,
    startUrl,
    runId,
    caseId,
    config: {
      apiKey: llmConfig.apiKey,
      baseURL: llmConfig.baseURL,
      model: llmConfig.model,
      maxSteps: 40,
      language: "en-US",
      max_tokens: llmConfig.max_tokens ?? 8192,
    },
  };

  const res = await fetch(`${BRIDGE_BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8 * 60 * 1000),
  });

  const body = (await res.json()) as { success?: boolean; data?: string; error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? body.data ?? `Bridge HTTP ${res.status}`);
  }

  return {
    success: body.success ?? false,
    data: body.data ?? "",
  };
}

// ── Test talimatı oluşturucu ──────────────────────────────────────────────────

function buildTaskPrompt(tc: TestCase, rootUrl: string): string {
  return `Sen bir QA otomasyon uzmanısın. Aşağıdaki test senaryosunu Chrome tarayıcısında gerçekleştir.

## Test Bilgileri
- **ID**: ${tc.id}
- **Başlık**: ${tc.title}
- **Platform**: ${tc.platform.join(", ")}
- **Öncelik**: ${tc.priority}
- **Tag**: ${tc.tags.join(", ")}
${tc.domain ? `- **Domain**: ${tc.domain}` : ""}

## Başlangıç URL
${rootUrl}

## Test Talimatı
${tc.prompt}

## Beklenen Sonuç
${tc.expectedOutcome}

## Kurallar
1. Her adımı yapmadan önce sayfanın tam yüklendiğini doğrula
2. Element bulamazsan scroll et veya bekle
3. Overlay/modal varsa önce kapat
4. Her işlem sonrasında beklenen değişikliğin gerçekleştiğini kontrol et
5. Tüm adımları tamamladıktan sonra:
   - Başarılı ise: done(true, "PASS: <başarı özeti>")
   - Başarısız ise: done(false, "FAIL: <başarısızlık nedeni>")

Şimdi testi başlat.`;
}

// ── Platform → URL eşlemesi ───────────────────────────────────────────────────

function getBaseUrl(platform: Platform, environment: "preprod" | "prod" = "preprod"): string {
  const urls: Record<"preprod" | "prod", Record<Platform, string>> = {
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
  };
  return urls[environment][platform] ?? urls[environment].website;
}

// ── Özet formatlayıcı ─────────────────────────────────────────────────────────

function formatTestCaseSummary(tc: TestCase): string {
  return `[${tc.id}] ${tc.title}
  Platform: ${tc.platform.join(", ")} | Tag: ${tc.tags.join(", ")} | Öncelik: ${tc.priority}${tc.domain ? ` | Domain: ${tc.domain}` : ""}`;
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "qa-agent",
  version: "1.0.0",
});

// ── Araç 1: list_test_cases ───────────────────────────────────────────────────

server.registerTool(
  "list_test_cases",
  {
    description:
      "Tüm test case'leri listeler. Platform, tag veya önceliğe göre filtrelenebilir.",
    inputSchema: {
      platform: z
        .enum(["backoffice", "partner", "website"])
        .optional()
        .describe("Filtrelenecek platform (opsiyonel)"),
      tag: z
        .enum(["smoke", "regression", "monkey"])
        .optional()
        .describe("Filtrelenecek tag (opsiyonel)"),
      priority: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Filtrelenecek öncelik (opsiyonel)"),
      domain: z
        .string()
        .optional()
        .describe("Filtrelenecek domain (opsiyonel, örn: identity, order, inventory)"),
    },
  },
  async ({ platform, tag, priority, domain }) => {
    let cases: TestCase[];

    if (platform && tag) {
      cases = loadTestCases(platform, tag);
    } else if (platform) {
      const tags: Tag[] = ["smoke", "regression", "monkey"];
      const seen = new Set<string>();
      cases = [];
      for (const t of tags) {
        for (const c of loadTestCases(platform, t)) {
          if (!seen.has(c.id)) { seen.add(c.id); cases.push(c); }
        }
      }
    } else if (tag) {
      const platforms: Platform[] = ["backoffice", "partner", "website"];
      const seen = new Set<string>();
      cases = [];
      for (const p of platforms) {
        for (const c of loadTestCases(p, tag)) {
          if (!seen.has(c.id)) { seen.add(c.id); cases.push(c); }
        }
      }
    } else {
      cases = loadAllCases();
    }

    if (priority) {
      cases = cases.filter((c) => c.priority === priority);
    }

    if (domain) {
      cases = cases.filter((c) => c.domain === domain);
    }

    cases.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    if (cases.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Belirtilen kriterlere uyan test case bulunamadı.",
          },
        ],
      };
    }

    const grouped: Record<string, TestCase[]> = {};
    for (const c of cases) {
      const key = c.platform[0] ?? "unknown";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    }

    const lines: string[] = [
      `Toplam ${cases.length} test case bulundu:\n`,
    ];

    for (const [plat, group] of Object.entries(grouped)) {
      lines.push(`\n### ${plat.toUpperCase()} (${group.length} test)\n`);
      for (const tc of group) {
        lines.push(formatTestCaseSummary(tc));
      }
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── Araç 2: get_bridge_status ─────────────────────────────────────────────────

server.registerTool(
  "get_bridge_status",
  {
    description:
      "Page Agent bridge ve Chrome Extension bağlantı durumunu kontrol eder. Test çalıştırmadan önce çağırın.",
  },
  async () => {
    const status = await checkBridgeStatus();
    const llmConfig = getLlmConfig();

    const lines: string[] = [
      `## Page Agent Bridge Durumu`,
      ``,
      `**Bridge (${BRIDGE_BASE})**: ${status.connected ? "✅ Bağlı" : "❌ Bağlı değil"}`,
      `**Meşgul**: ${status.busy ? "⏳ Evet (görev çalışıyor)" : "✅ Hayır (hazır)"}`,
      `**LLM Yapılandırması**: ${llmConfig ? `✅ Hazır (model: ${llmConfig.model})` : "❌ Eksik (.env.local kontrol edin)"}`,
    ];

    if (status.error) {
      lines.push(``, `**Hata**: ${status.error}`);
      lines.push(
        ``,
        `**Çözüm**: Ayrı bir terminalde \`npm run bridge\` komutunu çalıştırın, sonra Chrome'da http://localhost:${BRIDGE_PORT} adresini açın.`
      );
    }

    if (llmConfig) {
      lines.push(``, `**Model**: \`${llmConfig.model}\``);
      lines.push(`**Base URL**: \`${llmConfig.baseURL}\``);
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── Araç 3: run_test_case ─────────────────────────────────────────────────────

server.registerTool(
  "run_test_case",
  {
    description:
      "Belirtilen ID ile tek bir test case'i çalıştırır. Bridge bağlı olmalı. Sonuç PASS/FAIL döner.",
    inputSchema: {
      test_id: z
        .string()
        .describe(
          "Çalıştırılacak test case ID'si (örn: TC-BO-001, TC-PA-002). list_test_cases ile listelenebilir."
        ),
      platform: z
        .enum(["backoffice", "partner", "website"])
        .optional()
        .describe("Hangi platform URL'inde çalıştırılacak. Test case'de birden fazla platform varsa seçin."),
      environment: z
        .enum(["preprod", "prod"])
        .optional()
        .default("preprod")
        .describe("Hedef ortam: preprod (varsayılan) veya prod"),
    },
  },
  async ({ test_id, platform, environment = "preprod" }) => {
    // Köprü durumunu kontrol et
    const status = await checkBridgeStatus();
    if (!status.connected) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Bridge bağlı değil.\n\nAyrı bir terminalde şu komutu çalıştırın:\n\`\`\`\nnpm run bridge\n\`\`\`\n\nArdından Chrome'da http://localhost:${BRIDGE_PORT} adresini açarak Page Agent Extension'ı bağlayın.`,
          },
        ],
      };
    }

    if (status.busy) {
      return {
        content: [
          {
            type: "text" as const,
            text: `⏳ Bridge şu an meşgul. Çalışan görev bitene kadar bekleyin veya \`stop_test\` aracını kullanın.`,
          },
        ],
      };
    }

    // Test case'i bul
    const cases = loadCasesByIds([test_id]);
    if (cases.length === 0) {
      const allCases = loadAllCases();
      const allIds = allCases.map((c) => c.id).join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Test case bulunamadı: "${test_id}"\n\nMevcut ID'ler: ${allIds}`,
          },
        ],
      };
    }

    const tc = cases[0]!;

    // Platform belirle
    const targetPlatform: Platform =
      platform ??
      (tc.platform[0] as Platform) ??
      "website";

    if (!tc.platform.includes(targetPlatform)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `⚠️ "${test_id}" test case'i "${targetPlatform}" platformunu desteklemiyor.\nDesteklenen platformlar: ${tc.platform.join(", ")}`,
          },
        ],
      };
    }

    const rootUrl = getBaseUrl(targetPlatform, environment as "preprod" | "prod");
    const task = buildTaskPrompt(tc, rootUrl);
    const runId = `mcp-${Date.now()}`;

    const startLines: string[] = [
      `## Test Başlatıldı`,
      ``,
      `- **ID**: ${tc.id}`,
      `- **Başlık**: ${tc.title}`,
      `- **Platform**: ${targetPlatform}`,
      `- **Ortam**: ${environment}`,
      `- **URL**: ${rootUrl}`,
      ``,
      `⏳ Agent çalışıyor...`,
    ];

    process.stderr.write(`[mcp-server] Test başlatıldı: ${tc.id} | ${targetPlatform} | ${environment}\n`);

    try {
      const result = await executeViaBridge(task, rootUrl, runId, tc.id);

      const passed = result.success && !result.data.toLowerCase().includes("fail");

      const resultLines: string[] = [
        ...startLines.slice(0, -1),
        ``,
        `## Sonuç: ${passed ? "✅ PASS" : "❌ FAIL"}`,
        ``,
        `**Bridge Başarı**: ${result.success ? "true" : "false"}`,
        ``,
        `**Agent Çıktısı**:`,
        result.data || "(çıktı yok)",
      ];

      return {
        content: [{ type: "text" as const, text: resultLines.join("\n") }],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `## Sonuç: ❌ HATA\n\n**Hata**: ${errMsg}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Araç 4: run_test_suite ────────────────────────────────────────────────────

server.registerTool(
  "run_test_suite",
  {
    description:
      "Platform ve tag'e göre filtrelenmiş test suite'ini sırayla çalıştırır. Critical test başarısız olursa geri kalanlar atlanır.",
    inputSchema: {
      platform: z
        .enum(["backoffice", "partner", "website"])
        .describe("Test çalıştırılacak platform"),
      tag: z
        .enum(["smoke", "regression", "monkey"])
        .describe("Çalıştırılacak test suite tipi"),
      environment: z
        .enum(["preprod", "prod"])
        .optional()
        .default("preprod")
        .describe("Hedef ortam: preprod (varsayılan) veya prod"),
      max_cases: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Çalıştırılacak maksimum test sayısı (varsayılan: tümü)"),
      priority_filter: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Sadece bu öncelik ve üstündeki testleri çalıştır (opsiyonel)"),
    },
  },
  async ({ platform, tag, environment = "preprod", max_cases, priority_filter }) => {
    // Bridge durumunu kontrol et
    const status = await checkBridgeStatus();
    if (!status.connected) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Bridge bağlı değil.\n\nÖnce \`npm run bridge\` çalıştırın ve Chrome'da http://localhost:${BRIDGE_PORT} adresini açın.`,
          },
        ],
      };
    }

    if (status.busy) {
      return {
        content: [
          {
            type: "text" as const,
            text: `⏳ Bridge şu an meşgul. Çalışan görev bitene kadar bekleyin veya \`stop_test\` aracını kullanın.`,
          },
        ],
      };
    }

    // Test case'leri yükle
    let cases = loadTestCases(platform, tag);

    if (cases.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `⚠️ "${platform}/${tag}" için test case bulunamadı.`,
          },
        ],
      };
    }

    // Öncelik filtresi
    if (priority_filter) {
      const minOrder = PRIORITY_ORDER[priority_filter];
      cases = cases.filter((c) => PRIORITY_ORDER[c.priority] <= minOrder);
    }

    // Önceliğe göre sırala
    cases.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    // Max case limiti
    if (max_cases && max_cases < cases.length) {
      cases = cases.slice(0, max_cases);
    }

    const rootUrl = getBaseUrl(platform as Platform, environment as "preprod" | "prod");
    const total = cases.length;

    process.stderr.write(
      `[mcp-server] Suite başlatıldı: ${platform}/${tag} | ${total} test | ${environment}\n`
    );

    const results: Array<{
      id: string;
      title: string;
      status: "PASS" | "FAIL" | "SKIP";
      durationMs: number;
      error?: string;
    }> = [];

    let skipRemaining = false;
    const suiteStart = Date.now();

    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i]!;

      if (skipRemaining) {
        results.push({
          id: tc.id,
          title: tc.title,
          status: "SKIP",
          durationMs: 0,
          error: "Critical test başarısız olduğu için atlandı",
        });
        process.stderr.write(`[mcp-server] SKIP [${i + 1}/${total}] ${tc.id}\n`);
        continue;
      }

      process.stderr.write(`[mcp-server] Running [${i + 1}/${total}] ${tc.id}: ${tc.title}\n`);

      const task = buildTaskPrompt(tc, rootUrl);
      const runId = `mcp-suite-${Date.now()}`;
      const start = Date.now();

      try {
        const result = await executeViaBridge(task, rootUrl, runId, tc.id);
        const durationMs = Date.now() - start;

        const passed =
          result.success && !result.data.toLowerCase().includes("fail");

        const r = {
          id: tc.id,
          title: tc.title,
          status: (passed ? "PASS" : "FAIL") as "PASS" | "FAIL",
          durationMs,
          ...(!passed ? { error: result.data.slice(0, 300) } : {}),
        };

        results.push(r);
        process.stderr.write(
          `[mcp-server] ${r.status} [${i + 1}/${total}] ${tc.id} (${durationMs}ms)\n`
        );

        if (r.status === "FAIL" && tc.priority === "critical") {
          skipRemaining = true;
          process.stderr.write(`[mcp-server] Critical test başarısız — geri kalanlar atlanacak\n`);
        }
      } catch (err) {
        const durationMs = Date.now() - start;
        const errMsg = err instanceof Error ? err.message : String(err);

        results.push({
          id: tc.id,
          title: tc.title,
          status: "FAIL",
          durationMs,
          error: errMsg,
        });

        process.stderr.write(`[mcp-server] FAIL [${i + 1}/${total}] ${tc.id}: ${errMsg.slice(0, 80)}\n`);

        if (tc.priority === "critical") {
          skipRemaining = true;
        }
      }
    }

    const suiteDuration = Date.now() - suiteStart;
    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    const skipped = results.filter((r) => r.status === "SKIP").length;
    const passRate = total > 0 ? Math.round((passed / (total - skipped)) * 100) : 0;

    // Rapor oluştur
    const lines: string[] = [
      `## Suite Sonuç Raporu`,
      ``,
      `**Platform**: ${platform} | **Tag**: ${tag} | **Ortam**: ${environment}`,
      `**Süre**: ${Math.round(suiteDuration / 1000)}s`,
      ``,
      `| Durum | Sayı |`,
      `|-------|------|`,
      `| ✅ PASS | ${passed} |`,
      `| ❌ FAIL | ${failed} |`,
      `| ⏭️ SKIP | ${skipped} |`,
      `| **Toplam** | ${total} |`,
      `| **Başarı Oranı** | %${passRate} |`,
      ``,
      `## Test Detayları`,
      ``,
    ];

    for (const r of results) {
      const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️";
      const duration = r.durationMs > 0 ? ` (${Math.round(r.durationMs / 1000)}s)` : "";
      lines.push(`${icon} **[${r.id}]** ${r.title}${duration}`);
      if (r.error) {
        lines.push(`   > ${r.error.split("\n")[0]}`);
      }
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── Araç 5: stop_test ─────────────────────────────────────────────────────────

server.registerTool(
  "stop_test",
  {
    description: "Şu anda çalışan testi veya suite'i durdurur.",
  },
  async () => {
    try {
      const res = await fetch(`${BRIDGE_BASE}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Durdurma sinyali gönderildi. Çalışan görev iptal edildi.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: `⚠️ Durdurma isteği başarısız: HTTP ${res.status}`,
            },
          ],
        };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Bridge'e ulaşılamadı: ${errMsg}\n\nBridge çalışmıyor olabilir.`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Server başlat ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[qa-agent-mcp] MCP server hazır (stdio)\n` +
    `[qa-agent-mcp] Bridge: ${BRIDGE_BASE}\n` +
    `[qa-agent-mcp] Araçlar: list_test_cases, get_bridge_status, run_test_case, run_test_suite, stop_test\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[qa-agent-mcp] Başlatma hatası: ${err}\n`);
  process.exit(1);
});
