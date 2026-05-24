import path from "path";
import fs from "fs";
import { getDb } from "../lib/db/index";

/**
 * Seed script: verifies DB initializes and test case files are present.
 * Also creates data/system-prompt.json from the example if it doesn't exist.
 */

async function seed() {
  console.log("🔧 QA Agent — Seed başlatılıyor...\n");

  // 1. Initialize DB
  const db = getDb();
  console.log("✓ SQLite DB hazır:", path.join(process.cwd(), "data", "qa-agent.db"));

  // 2. Copy system-prompt.json if missing
  const spPath = path.join(process.cwd(), "data", "system-prompt.json");
  const exPath = path.join(process.cwd(), "data", "system-prompt.json.example");

  if (!fs.existsSync(spPath) && fs.existsSync(exPath)) {
    fs.copyFileSync(exPath, spPath);
    console.log("✓ data/system-prompt.json oluşturuldu (example'dan kopyalandı)");
    console.log("  ⚠️  Gerçek credentials ile güncellemeyi unutmayın!\n");
  } else if (fs.existsSync(spPath)) {
    console.log("✓ data/system-prompt.json mevcut");
  } else {
    console.warn("⚠️  data/system-prompt.json.example bulunamadı");
  }

  // 3. List test cases
  const platforms = ["backoffice", "partner", "website"];
  const tags = ["smoke", "regression", "monkey"];
  let total = 0;

  console.log("\n📋 Test Case Özeti:");
  for (const platform of platforms) {
    let platformTotal = 0;
    for (const tag of tags) {
      const fPath = path.join(process.cwd(), "data", "test-cases", platform, `${tag}.json`);
      if (fs.existsSync(fPath)) {
        const cases = JSON.parse(fs.readFileSync(fPath, "utf-8"));
        console.log(`  ${platform}/${tag}.json → ${cases.length} case`);
        platformTotal += cases.length;
        total += cases.length;
      }
    }
    console.log(`  → ${platform} toplam: ${platformTotal}`);
  }

  console.log(`\n✓ Toplam: ${total} test case yüklendi`);

  // 4. Verify DB tables
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  console.log("\n✓ DB Tabloları:", tables.map((t) => t.name).join(", "));

  console.log("\n✅ Seed tamamlandı! Uygulamayı başlatmak için:");
  console.log("   cp .env.local.example .env.local");
  console.log("   # .env.local dosyasını LLM API bilgileriyle düzenle");
  console.log("   npm run dev\n");
}

seed().catch(console.error);
