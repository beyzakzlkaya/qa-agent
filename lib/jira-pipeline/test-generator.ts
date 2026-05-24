/**
 * lib/jira-pipeline/test-generator.ts
 *
 * JIRA task + PR analizi kullanarak test case'leri üretir.
 * Context, getmobil-e2e-test-prompt-library knowledge base üzerinden agent'a sağlanır.
 */

import type {
  JiraTaskMeta,
  PrAnalysis,
  ContextCache,
  GeneratedTestSuite,
  TestCase,
  Platform,
} from "../types";
import { getLlmConfig } from "../mcp-bridge/hub-wrapper";
import { logLlmRequest, logInfo, logError } from "../logger";
import { extractDiffRisks } from "./diff-risks";
import { buildOpenAiChatBody } from "./llm-request";
import { executeTestSuite } from "../test-engine/executeTestSuite";

export { extractDiffRisks };

// ── JIRA Description Deep Analyzer ─────────────────────────────────────────────

interface JiraDescriptionAnalysis {
  functionalAreas: string[];
  acceptanceCriteria: string[];
  riskKeywords: string[];
  userStories: string[];
  technicalNotes: string[];
}

export function analyzeJiraDescription(jira: JiraTaskMeta): JiraDescriptionAnalysis {
  const fullText = [
    jira.summary ?? "",
    jira.description ?? "",
    jira.acceptanceCriteria ?? "",
    ...(jira.comments ?? []),
  ].join("\n").toLowerCase();

  const rawDesc = [jira.description ?? "", jira.acceptanceCriteria ?? ""].join("\n");

  // ── Functional area detection ──
  const functionalAreas: string[] = [];
  if (/login|otp|giri[sş]|kimlik|auth/i.test(fullText)) functionalAreas.push("authentication");
  if (/profil|hesap|account|settings|ayar/i.test(fullText)) functionalAreas.push("user-profile");
  if (/ürün|product|listing|katalog|kategori/i.test(fullText)) functionalAreas.push("product-listing");
  if (/arama|search|filter|filtre/i.test(fullText)) functionalAreas.push("search");
  if (/bildirim|notification|sms|email/i.test(fullText)) functionalAreas.push("notifications");
  if (/backoffice|admin|bo\.|yönetim/i.test(fullText)) functionalAreas.push("backoffice");
  if (/partner|bayi|dealer/i.test(fullText)) functionalAreas.push("partner");
  if (/dashboard|panel/i.test(fullText)) functionalAreas.push("dashboard");
  if (/fatura|invoice|vergi|tax/i.test(fullText)) functionalAreas.push("billing");
  if (/kargo|teslimat|delivery|shipping/i.test(fullText)) functionalAreas.push("delivery");
  if (/iade|refund|return|iptal|cancel/i.test(fullText)) functionalAreas.push("returns");
  if (/banner|kampanya|campaign|promosyon|promo|kupon|coupon/i.test(fullText)) functionalAreas.push("promotions");

  // ── Acceptance criteria extraction ──
  const acceptanceCriteria: string[] = [];
  const acPatterns = [
    /(?:kabul kriteri|acceptance criteria|given|when|then|AC\s*[-:]|✓|✅)[^\n]*\n?([^\n]+)/gi,
    /[-•*]\s*([^\n]{10,})/g,
    /\d+\.\s+([^\n]{10,})/g,
  ];
  for (const pattern of acPatterns) {
    let m: RegExpExecArray | null;
    const target = rawDesc;
    while ((m = pattern.exec(target)) !== null) {
      const item = (m[1] ?? m[0]).trim();
      if (item.length > 8 && !acceptanceCriteria.includes(item)) {
        acceptanceCriteria.push(item);
      }
    }
  }

  // ── User story extraction ──
  const userStories: string[] = [];
  const storyMatch = rawDesc.match(/as a[^\n]+\n?.*i want[^\n]+|user should[^\n]+|kullanıcı[^\n]+yapabilmeli[^\n]*/gi);
  if (storyMatch) userStories.push(...storyMatch.map((s) => s.trim()).slice(0, 5));

  // ── Risk keywords from description ──
  const riskKeywords: string[] = [];
  if (/zorunlu|required|must|shall/i.test(rawDesc)) riskKeywords.push("zorunlu alan/davranış belirtilmiş");
  if (/hata|error|fail|başarısız|exception/i.test(rawDesc)) riskKeywords.push("hata senaryosu description'da geçiyor");
  if (/eski|eski akış|eskiden|previously|old|deprecated/i.test(rawDesc)) riskKeywords.push("eski davranıştan geçiş — regresyon riski");
  if (/performan[sc]|gecikme|timeout|yavaş|slow/i.test(rawDesc)) riskKeywords.push("performans/timeout gereksinimi var");
  if (/mobil|mobile|responsive|tablet/i.test(rawDesc)) riskKeywords.push("mobil/responsive davranış test edilmeli");
  if (/rol|role|permission|yetki|izin/i.test(rawDesc)) riskKeywords.push("rol/yetki kontrolleri test edilmeli");
  if (/sıfırla|reset|temizle|clear/i.test(rawDesc)) riskKeywords.push("state sıfırlama davranışı test edilmeli");

  // ── Technical notes ──
  const technicalNotes: string[] = [];
  const techMatch = rawDesc.match(/api[^\n]+|endpoint[^\n]+|component[^\n]+|hook[^\n]+|redux[^\n]+|store[^\n]+/gi);
  if (techMatch) technicalNotes.push(...techMatch.map((s) => s.trim()).slice(0, 5));

  return { functionalAreas, acceptanceCriteria, riskKeywords, userStories, technicalNotes };
}

// ── Context relevance scoring ──────────────────────────────────────────────────

/**
 * getmobil-e2e-test-prompt-library'den gelen TC dokümanlarını
 * task ve PR context'ine göre puanlar; en ilgili N tanesini döner.
 */
function selectRelevantContext(
  ctx: ContextCache,
  jira: JiraTaskMeta,
  pr: PrAnalysis | null,
  descAnalysis: JiraDescriptionAnalysis,
  maxItems = 6,
  maxCharsEach = 1200,
): string {
  const searchTerms = [
    jira.summary,
    ...descAnalysis.functionalAreas,
    ...(pr?.changedFiles ?? []).map((f) => f.split("/").pop()?.replace(/\.[^.]+$/, "") ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  type Scored = { key: string; content: string; score: number };
  const scored: Scored[] = [];

  for (const [key, content] of Object.entries(ctx.testCases)) {
    const haystack = (key + " " + content).toLowerCase();
    let score = 0;
    for (const area of descAnalysis.functionalAreas) {
      if (haystack.includes(area)) score += 4;
    }
    const words = searchTerms.split(/\s+/).filter((w) => w.length > 3);
    for (const w of words) {
      if (haystack.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ key, content, score });
  }

  for (const [key, content] of Object.entries(ctx.domains)) {
    const haystack = (key + " " + content).toLowerCase();
    let score = 0;
    for (const area of descAnalysis.functionalAreas) {
      if (haystack.includes(area)) score += 2;
    }
    if (score > 0) scored.push({ key, content, score });
  }

  for (const [key, content] of Object.entries(ctx.flows)) {
    const haystack = (key + " " + content).toLowerCase();
    let score = 0;
    const words = searchTerms.split(/\s+/).filter((w) => w.length > 3);
    for (const w of words) {
      if (haystack.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ key, content, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxItems);

  if (top.length === 0) return "";

  return (
    "## getmobil-e2e-test-prompt-library — İlgili Referans Dokümanlar\n" +
    "Bu dokümanlar test adımlarını ve selector/flow bilgilerini içerir. " +
    "Test case yazarken buradaki pattern ve adımları kullan:\n\n" +
    top
      .map(
        ({ key, content }) =>
          `### 📚 ${key}\n${content.slice(0, maxCharsEach)}${content.length > maxCharsEach ? "\n[...kısaltıldı]" : ""}`,
      )
      .join("\n\n")
  );
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildGeneratorPrompt(
  jira: JiraTaskMeta,
  pr: PrAnalysis | null,
  ctx: ContextCache,
): string {
  // ── JIRA description deep analysis ──
  const descAnalysis = analyzeJiraDescription(jira);

  const descAnalysisSection = [
    descAnalysis.functionalAreas.length > 0
      ? `Tespit Edilen Fonksiyonel Alanlar: ${descAnalysis.functionalAreas.join(", ")}`
      : "",
    descAnalysis.riskKeywords.length > 0
      ? `Description'dan Risk Sinyalleri:\n${descAnalysis.riskKeywords.map((r) => `  ⚠ ${r}`).join("\n")}`
      : "",
    descAnalysis.acceptanceCriteria.length > 0
      ? `Parse Edilen Kabul Kriterleri:\n${descAnalysis.acceptanceCriteria.slice(0, 10).map((ac) => `  ✓ ${ac}`).join("\n")}`
      : "",
    descAnalysis.userStories.length > 0
      ? `Kullanıcı Hikâyeleri:\n${descAnalysis.userStories.map((us) => `  → ${us}`).join("\n")}`
      : "",
    descAnalysis.technicalNotes.length > 0
      ? `Teknik İpuçları:\n${descAnalysis.technicalNotes.slice(0, 5).map((t) => `  🔧 ${t}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // ── getmobil-e2e-test-prompt-library context ──
  const libraryContext = selectRelevantContext(ctx, jira, pr, descAnalysis);

  // ── PR bölümü: metadata + gerçek kod diff ──
  let prSection: string;
  let diffRiskDirectives = "";

  if (pr) {
    const diffBlock = pr.codeChangeSummary
      ? `\n### Kod Değişiklik Detayı (Gerçek Diff Özeti)\n${pr.codeChangeSummary.slice(0, 2500)}`
      : "";

    const criticalFiles = pr.fileChanges
      .filter(
        (f) =>
          /\.(tsx?|jsx?|vue|svelte|py|go|java|rb|cs)$/.test(f.filename) &&
          f.patch &&
          f.additions + f.deletions > 2,
      )
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, 6);

    const patchBlock =
      criticalFiles.length > 0
        ? "\n### Değişen Kod Dosyaları (Ham Patch)\n" +
          criticalFiles
            .map((f) => {
              const addedLines = (f.patch ?? "")
                .split("\n")
                .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
                .map((l) => l.slice(1).trim())
                .filter((l) => l.length > 3)
                .slice(0, 25)
                .join("\n  + ");
              const removedLines = (f.patch ?? "")
                .split("\n")
                .filter((l) => l.startsWith("-") && !l.startsWith("---"))
                .map((l) => l.slice(1).trim())
                .filter((l) => l.length > 3)
                .slice(0, 10)
                .join("\n  - ");
              const parts = [`**${f.filename}** (+${f.additions}/-${f.deletions})`];
              if (addedLines) parts.push(`  Eklenen satırlar:\n  + ${addedLines}`);
              if (removedLines) parts.push(`  Silinen satırlar:\n  - ${removedLines}`);
              return parts.join("\n");
            })
            .join("\n\n")
        : "";

    const risks = extractDiffRisks(pr);
    if (risks.length > 0) {
      diffRiskDirectives =
        "\n## Diff'ten Tespit Edilen Riskli Noktalar (BUNLARI TEST ET)\n" +
        "Aşağıdaki her madde için en az bir test case üretilmeli:\n" +
        risks.map((r, i) => `${i + 1}. ${r}`).join("\n");
    }

    prSection = `## PR Analizi (GitHub Diff)
PR: ${pr.prUrl ?? "—"}
Başlık: ${pr.title}
Tetikleyici aksiyon: ${pr.triggerAction}
Değişen dosyalar (${pr.changedFiles.length}): ${pr.diffSummary}
${pr.description ? `\nPR Açıklaması:\n${pr.description.slice(0, 1000)}` : ""}
${diffBlock}
${patchBlock}
${diffRiskDirectives}`;
  } else {
    prSection = "PR bilgisi mevcut değil — test case'ler JIRA description ve kabul kriterlerine dayalı üretilecek.";
  }

  const commentsSection =
    jira.comments && jira.comments.length > 0
      ? `## JIRA Yorumları (${jira.comments.length} yorum)\n` +
        jira.comments
          .map((c, i) => `### Yorum ${i + 1}\n${c.slice(0, 600)}`)
          .join("\n\n")
      : "";

  const riskCount = pr ? extractDiffRisks(pr).length : 0;
  const descRiskCount = descAnalysis.riskKeywords.length;

  const taskInstruction = `## GÖREV
Öncelik sırası:
1. **"Diff'ten Tespit Edilen Riskli Noktalar"** — ${riskCount > 0 ? `${riskCount} madde var, her birini test et.` : "PR yoksa JIRA kabul kriterlerini kullan."}
2. **JIRA Description Analizi** — ${descRiskCount > 0 ? `${descRiskCount} risk sinyali tespit edildi, bunları kapsayan test case'ler üret.` : "Fonksiyonel alanları ve kabul kriterlerini kapsayan test case'ler üret."}
3. **"PR Analizi / Ham Patch"** — hangi satırlar eklendi/silindi? Bunları doğrudan test senaryosuna çevir.
4. **getmobil-e2e-test-prompt-library Dokümanları** — yukarıdaki referans dokümanları kullanarak test adımlarını Getmobil'in gerçek URL/selector/flow yapısına göre yaz.

KURAL: Test case'leri JIRA description + diff analizine dayandır. Gerçek değişen/tanımlanan özelliği test et.
Referans dokümanlardan gelen selector, URL ve flow bilgilerini kullan — uydurma.
Her risk maddesi → en az bir test case.
SADECE JSON döndür, başka hiçbir şey yazma:`;

  return `## JIRA Task: ${jira.key}
Özet: ${jira.summary}
${jira.description ? `\nDescription:\n${jira.description.slice(0, 1200)}` : ""}
${jira.acceptanceCriteria ? `\nKabul Kriterleri:\n${jira.acceptanceCriteria.slice(0, 600)}` : ""}

## JIRA Description Analizi
${descAnalysisSection || "(analiz verisi bulunamadı)"}

${commentsSection ? commentsSection + "\n\n---\n\n" : ""}${prSection}

---

${libraryContext ? libraryContext + "\n\n---\n\n" : ""}

${taskInstruction}

{
  "happy_paths": [
    {
      "id": "TC-001",
      "title": "Kısa açıklayıcı başlık",
      "steps": [
        "1. İlgili bölüme git",
        "2. Test edilen aksiyonu gerçekleştir",
        "3. Beklenen sonucun göründüğünü doğrula"
      ],
      "expected": "Spesifik, doğrulanabilir çıktı"
    }
  ],
  "edge_cases": [
    {
      "id": "EC-001",
      "title": "Edge case başlığı",
      "steps": ["..."],
      "expected": "..."
    }
  ],
  "skip_reason": []
}

Kısıtlamalar: happy_paths 4–6, edge_cases 1–4, skip_reason yalnızca UI üzerinden gerçekten test edilemeyecek durumlar için.`;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const GENERATOR_SYSTEM_PROMPT = `Sen Getmobil platformunu bilen deneyimli bir QA mühendisisin.
Sana bir JIRA task, GitHub PR diff analizi ve getmobil-e2e-test-prompt-library'den ilgili referans dokümanlar veriyorum.
Görevin: Bu değişiklikleri test etmek için net, icra edilebilir E2E test case'leri üretmek.
Test adımlarında Getmobil'in gerçek URL'lerini, selector'larını ve flow'larını kullan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLATFORM LOGIN BİLGİLERİ — getmobil-e2e-test-prompt-library (master, 2026-04-14)
Bu bilgiler KESİN ve DOĞRU. Asla değiştirme, asla uydurma.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### PARTNER PORTAL — TC-IDENTITY-001 / SHARED-PRE-001
- Login URL: \${PARTNER_PORTAL_URL}/giris-yap
- Email field: [data-testid="email-input"]
- Password field: [data-testid="password-input"]
- Submit button: [data-testid="login-button"]  → "Giriş Yap"
- Redirect sonrası: /dashboard/overview

### BACKOFFICE — TC-BO-009 / SHARED-PRE-002
- Login URL: \${BACKOFFICE_URL}/authentication/sign-in/
- Heading: "Giriş", subtitle: "Giriş için email ve şifrenizi giriniz"
- Email ve password alanları mevcut; password show/hide toggle var
- Submit button: "Giriş"
- Redirect sonrası: backoffice dashboard

### WEBSITE (preprod.getmobil.com) — TC-IDENTITY-009 — MODAL AKIŞ
⚠️  /giris, /login, /giris-yap gibi BİR LOGIN URL YOKTUR. ASLA UYDURMA.
⚠️  Login bir MODAL akışıdır, dedicated URL değildir.

Adımlar:
1. preprod.getmobil.com adresine git
2. Header'daki KİŞİ/SİLUET ikonuna tıkla — SEPET ikonunun SOLUNDAKI ikon
   - "Bayimiz Olun!" yazısının hemen sağında, sepet ikonunun hemen solundadır
   - En güvenilir yöntem: document.querySelector('#__next > main > header div[class] svg[viewBox="0 0 24 25"]').closest('div').click()
   - CSS: #__next > main > header div:nth-child(4) > div:nth-child(3) svg
   - XPath: //*[@id="__next"]/main/header/div[1]/div[4]/div[3]/div/div/svg
   - Modal açılmazsa SEPETE tıklandı demektir — yanlış ikon, method 1 ile yeniden dene
3. Modal açılır → başlık: "Getmobil'e Hoşgeldiniz!"
4. "Cep Telefonu Numarası" alanına telefon numarasını gir (+90 prefix zaten var, ülke kodu ekleme)
5. "Devam et" butonuna tıkla
6. OTP ekranı → 65099 gir (preprod statik OTP) → "Doğrula"
7. Toast: "Başarılı Bir Şekilde Giriş Yaptınız" görünmeli, modal kapanmalı
8. localStorage["getmobil_access_token"] dolu olmalı (non-empty JWT)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Temel kurallar:
- Adımlar HEDEF tanımlar ("sepet toplamının güncellendiğini doğrula"), UI mekaniği değil ("id='cart-btn' olan butona tıkla")
- URL, selector veya veri uydurmak yasaktır — yalnızca JIRA/PR girdisindeki ve referans dokümanlardaki bilgileri kullan
- Login her testten önce otomatik yapılır — test case adımlarına login adımı ekleme
- YALNIZCA geçerli JSON döndür, markdown veya açıklama yazma

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"prompt" ALANI YAZIM KURALLARI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Türkçe, doğal dil, adım adım yaz
- Adımları virgülle ayır
- Son adım MUTLAKA bir doğrulama olmalı: "...X'in göründüğünü doğrula"
- CSS selector KULLANMA (.class, #id gibi) — PageAgent bu tür selector'ları desteklemez
- Görünür label text'i, placeholder değerini veya data-testid değerini kullan
- Örnek: "'E-posta' alanına admin@test.com yaz, 'Giriş Yap' butonuna tıkla, Dashboard başlığının göründüğünü doğrula"`;

// ── LLM caller with retry ─────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [3000, 8000];

async function callLlmOnce(prompt: string): Promise<string> {
  const llmConfig = getLlmConfig();
  if (!llmConfig) {
    throw new Error("LLM konfigürasyonu bulunamadı. .env.local dosyasını kontrol edin.");
  }

  const isAnthropic = llmConfig.baseURL.includes("anthropic");
  const provider = isAnthropic ? "anthropic" : "openai";

  const endpoint = isAnthropic
    ? `${llmConfig.baseURL.replace(/\/$/, "")}/messages`
    : `${llmConfig.baseURL.replace(/\/$/, "")}/chat/completions`;

  const requestBody = isAnthropic
    ? {
        model: llmConfig.model,
        max_tokens: 8192,
        system: GENERATOR_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }
    : buildOpenAiChatBody({
        model: llmConfig.model,
        system: GENERATOR_SYSTEM_PROMPT,
        user: prompt,
        maxTokens: 8192,
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

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 8000;
      console.warn(`[callLlmOnce] Retry ${attempt}/${MAX_RETRIES} — ${delay}ms bekleniyor...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const callStart = Date.now();
    let responseStatus = 0;
    let responseBody: unknown = null;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(90_000),
      });

      responseStatus = res.status;
      const data = (await res.json()) as Record<string, unknown>;
      responseBody = data;

      logLlmRequest({
        runId: "jira-pipeline",
        caseId: "test-generator",
        provider,
        model: llmConfig.model,
        endpoint,
        requestBody,
        responseStatus,
        responseBody: data,
        durationMs: Date.now() - callStart,
      });

      if (!res.ok) {
        const errText = JSON.stringify(data).slice(0, 300);
        const err = new Error(`LLM API hatası: HTTP ${res.status} — ${errText}`);
        if (res.status === 429 || res.status >= 500) { lastError = err; continue; }
        throw err;
      }

      if (isAnthropic) {
        if ((data.stop_reason as string) === "max_tokens") {
          console.warn("[callLlmOnce] max_tokens — JSON truncated!");
        }
        const content = data.content as Array<{ type: string; text?: string }> | undefined;
        return content?.find((b) => b.type === "text")?.text ?? "";
      }

      const choices = data.choices as Array<{ message: { content: string }; finish_reason?: string }> | undefined;
      if (choices?.[0]?.finish_reason === "length") console.warn("[callLlmOnce] finish_reason=length — JSON truncated!");
      return choices?.[0]?.message?.content ?? "";
    } catch (fetchErr) {
      const durationMs = Date.now() - callStart;
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      logLlmRequest({
        runId: "jira-pipeline",
        caseId: "test-generator",
        provider,
        model: llmConfig.model,
        endpoint,
        requestBody,
        responseStatus,
        responseBody,
        durationMs,
        error: errMsg,
      });
      lastError = fetchErr instanceof Error ? fetchErr : new Error(errMsg);
      logError(`LLM çağrısı başarısız (deneme ${attempt + 1}/${MAX_RETRIES + 1}): ${errMsg}`, "jira-pipeline");
      if (lastError.name === "AbortError") throw lastError;
    }
  }

  throw lastError;
}

// ── JSON extractor ─────────────────────────────────────────────────────────────

function sanitizeJsonString(raw: string): string {
  return raw.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner: string) => {
    const escaped = inner
      .replace(/\r\n/g, "\\n")
      .replace(/\r/g, "\\n")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    return `"${escaped}"`;
  });
}

function tryParseJson(text: string): GeneratedTestSuite | null {
  try { return JSON.parse(text) as GeneratedTestSuite; } catch { return null; }
}

function extractJson(text: string): GeneratedTestSuite {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  let parsed = tryParseJson(cleaned) ?? tryParseJson(sanitizeJsonString(cleaned));

  if (!parsed) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = tryParseJson(jsonMatch[0]) ?? tryParseJson(sanitizeJsonString(jsonMatch[0]));
    }
  }

  if (!parsed) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const candidate = jsonMatch ? jsonMatch[0] : cleaned;
    const lines = candidate.split("\n");
    for (let drop = 1; drop <= Math.min(lines.length, 20); drop++) {
      const truncated = lines.slice(0, lines.length - drop).join("\n");
      const attempt =
        tryParseJson(truncated + "\n]}") ??
        tryParseJson(truncated + "\n]}}") ??
        tryParseJson(sanitizeJsonString(truncated + "\n]}"));
      if (attempt) { parsed = attempt; break; }
    }
  }

  if (!parsed) throw new Error("LLM yanıtında geçerli JSON bulunamadı");

  return {
    happy_paths: Array.isArray(parsed.happy_paths) ? parsed.happy_paths : [],
    edge_cases: Array.isArray(parsed.edge_cases) ? parsed.edge_cases : [],
    skip_reason: Array.isArray(parsed.skip_reason) ? parsed.skip_reason : [],
  };
}

// ── Platform inference ────────────────────────────────────────────────────────

function inferPlatform(jira: JiraTaskMeta, pr: PrAnalysis | null): Platform[] {
  const text = [jira.summary, jira.description, ...(pr?.changedFiles ?? [])].join(" ").toLowerCase();

  const platforms: Platform[] = [];
  if (/backoffice|admin|bo\./.test(text)) platforms.push("backoffice");
  if (/partner|bayi|dealer/.test(text)) platforms.push("partner");
  if (/website|web|\.com|customer|müşteri/.test(text)) platforms.push("website");

  if (platforms.length === 0) {
    console.warn("[test-generator] Platform bulunamadı, 'website' varsayılıyor.");
    return ["website"];
  }

  return platforms;
}

// ── Suite → TestCase[] ────────────────────────────────────────────────────────

export function suiteToTestCases(
  suite: GeneratedTestSuite,
  jira: JiraTaskMeta,
  pr: PrAnalysis | null,
  taskKey: string,
  _ctx?: ContextCache,
): TestCase[] {
  const platforms = inferPlatform(jira, pr);
  const cases: TestCase[] = [];

  for (const tc of suite.happy_paths) {
    cases.push({
      id: `${taskKey}-${tc.id}`,
      title: tc.title,
      platform: platforms,
      tags: ["regression"],
      priority: "high",
      prompt: tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      expectedOutcome: tc.expected,
    });
  }

  for (const ec of suite.edge_cases) {
    cases.push({
      id: `${taskKey}-${ec.id}`,
      title: `[Edge] ${ec.title}`,
      platform: platforms,
      tags: ["regression"],
      priority: "medium",
      prompt: ec.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      expectedOutcome: ec.expected,
    });
  }

  return cases;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function generateTestCases(
  jira: JiraTaskMeta,
  pr: PrAnalysis | null,
  ctx: ContextCache,
): Promise<{ suite: GeneratedTestSuite; cases: TestCase[] }> {
  logInfo(`Test case'ler üretiliyor: ${jira.key}`, "jira-pipeline");
  console.log(`[jira-pipeline] Test case'ler üretiliyor: ${jira.key}`);

  const prompt = buildGeneratorPrompt(jira, pr, ctx);
  const rawText = await callLlmOnce(prompt);
  const suite = extractJson(rawText);
  const cases = suiteToTestCases(suite, jira, pr, jira.key, ctx);

  logInfo(
    `${cases.length} test case üretildi: ${suite.happy_paths.length} happy path, ${suite.edge_cases.length} edge case`,
    "jira-pipeline",
  );
  console.log(
    `[jira-pipeline] ${cases.length} test case üretildi: ` +
    `${suite.happy_paths.length} happy path, ${suite.edge_cases.length} edge case`,
  );

  // ── Execution pipeline ──────────────────────────────────────────────────
  // selectRelevantContext() çıktısını domainDocs olarak ilet (max 4 doküman)
  const descAnalysis = analyzeJiraDescription(jira);
  const selectedDocsRaw = selectRelevantContext(ctx, jira, pr, descAnalysis, 4, 1200);
  const selectedDocs = selectedDocsRaw ? [selectedDocsRaw] : [];

  const { results, summary } = await executeTestSuite({
    testCases: cases,
    domainDocs: selectedDocs,
    baseUrl: process.env.BASE_URL ?? "",
    provider: "anthropic",
    filterPlatform: "backoffice",
    onProgress: (r, i, total) => {
      console.log(`[test-engine] [${i}/${total}] ${r.id} → ${r.status}`);
    },
  });

  logInfo(
    `Execution tamamlandı: ${summary.passed} PASS, ${summary.failed} FAIL, ${summary.skipped} SKIP (${summary.durationMs}ms)`,
    "jira-pipeline",
  );
  console.log(
    `[test-engine] Execution tamamlandı: ${summary.passed} PASS / ${summary.failed} FAIL / ${summary.skipped} SKIP`,
  );

  void results;

  return { suite, cases };
}
