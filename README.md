# QA Agent — Getmobil Test Otomasyon Platformu

Next.js 14 tabanlı, merkezi QA yönetim platformu. Tüm browser otomasyonu **@page-agent/mcp** ve WebSocket bridge üzerinden çalışır — Playwright, Puppeteer veya Selenium kullanılmaz.

## Ön Koşullar

- Node.js >= 20
- Chrome'da [Page Agent Extension](https://chromewebstore.google.com/detail/page-agent-ext/akldabonmimlicnjlflnapfeklbfemhj) kurulu
- Bir LLM API anahtarı (OpenAI uyumlu — Qwen, OpenAI, vb.)

## Kurulum

```bash
# 1. Bağımlılıkları kur
npm install

# 2. Ortam değişkenlerini ayarla
cp .env.local.example .env.local
# .env.local dosyasını LLM API bilgileriyle düzenle

# 3. Test verilerini başlat
npm run seed

# 4. Hassas test verilerini ayarla (isteğe bağlı ama önerilir)
cp data/system-prompt.json.example data/system-prompt.json
# data/system-prompt.json dosyasını gerçek test credentials'ları ile güncelle

# 5. Uygulamayı başlat
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini aç.

## .env.local Yapısı

```env
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-...
LLM_MODEL_NAME=qwen-plus
PAGE_AGENT_PORT=38401
PORT=3000
```

## Kullanım Akışı

1. Chrome'da **Page Agent Extension**'ı aç — extension `localhost:38401`'e bağlanacak
2. QA Agent platformunu başlat (`npm run dev`)
3. Header'daki **"Page Agent Bağlı"** göstergesi yeşil olana kadar bekle
4. **Test Suite** sayfasından case seç ve çalıştır veya **Prompt Editör**'den özel prompt yaz

## Sayfalar

| Sayfa | URL | Açıklama |
|---|---|---|
| Dashboard | `/` | Run geçmişi, istatistikler |
| Test Suite | `/test-suite` | Platform ağacı, case yönetimi |
| Prompt Editör | `/prompt` | Özel prompt oluştur ve çalıştır |
| Canlı Test | `/run/[runId]` | Gerçek zamanlı step takibi |
| Rapor Detay | `/reports/[runId]` | Detaylı test raporu |

## Test Case Formatı

```json
{
  "id": "TC-BO-001",
  "title": "Admin Login Flow",
  "platform": ["backoffice"],
  "tags": ["smoke", "regression"],
  "priority": "critical",
  "prompt": "Navigate to backoffice login...",
  "expectedOutcome": "Dashboard is visible"
}
```

Dosyalar: `data/test-cases/{platform}/{tag}.json`

## MCP Server — Cursor / Claude Entegrasyonu

Test case'lerinizi doğrudan Cursor veya Claude Desktop'tan çalıştırmak için gömülü **MCP server** kullanın.

### Otomatik Kurulum (Cursor)

`.cursor/mcp.json` dosyası projeye eklenmiştir. Cursor bu dosyayı otomatik olarak tanır — **Settings → MCP** sekmesinde `qa-agent` server'ının aktif olduğunu görmelisiniz.

### Manuel Çalıştırma

```bash
npm run mcp-server
```

### Araçlar

| Araç | Açıklama |
|---|---|
| `list_test_cases` | Platform/tag/önceliğe göre filtrelenmiş test listesi |
| `get_bridge_status` | Bridge ve Chrome Extension bağlantı durumu |
| `run_test_case` | Tek bir test case'i ID ile çalıştır (örn: `TC-BO-001`) |
| `run_test_suite` | Tüm suite'i çalıştır (örn: backoffice/smoke) |
| `stop_test` | Çalışan testi durdur |

### Örnek Kullanım (Cursor'da)

```
"backoffice smoke testlerini preprod'da çalıştır"
→ run_test_suite(platform="backoffice", tag="smoke", environment="preprod")

"TC-BO-001 testini çalıştır"
→ run_test_case(test_id="TC-BO-001")

"Tüm kritik testleri listele"
→ list_test_cases(priority="critical")
```

### Önkoşullar (MCP üzerinden test çalıştırmak için)

1. `npm run bridge` — ayrı terminalde çalıştırın
2. Chrome'da `http://localhost:38401` açın — Page Agent Extension bağlanacak
3. `.env.local` dosyasında `ANTHROPIC_API_KEY` veya `OPENAI_API_KEY` ayarlanmış olmalı

## Önemli Notlar

- `data/system-prompt.json` — .gitignore'da, commit'leme!
- Tüm test geçmişi `data/qa-agent.db` SQLite dosyasında tutulur
- WebSocket endpoint: `ws://localhost:3000/ws?runId={runId}`
