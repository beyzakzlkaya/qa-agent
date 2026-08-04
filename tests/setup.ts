/**
 * Her test dosyasından önce çalışır (setupFiles).
 *
 * - Testler gerçek data/ dizinine ve qa-agent.db'ye dokunmasın diye cwd'yi
 *   test dosyasına özel geçici bir dizine taşır (db/engine modülleri yolları
 *   process.cwd() üzerinden kurar).
 * - Snapshot engine bekleme sürelerini test hızı için kısaltır.
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-agent-test-"));
process.chdir(tmpDir);

process.env.SNAPSHOT_SETTLE_MS = "10";
process.env.SNAPSHOT_SAMPLE_INTERVAL_MS = "10";
process.env.SNAPSHOT_SCROLL_SETTLE_MS = "10";

// environments.ts import edilirken uyarı basmasın
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key";
