/**
 * lib/test-engine/headless-pool.ts
 *
 * Paralel + headless test koşumu için worker havuzu.
 *
 * Her worker:
 *   1. Kendi portunda bir bridge child process'i başlatır (38402, 38403, ...).
 *   2. puppeteer-core ile sistemdeki Chrome'u HEADLESS başlatır; Page Agent
 *      extension'ı --load-extension ile yüklenir (kullanıcının Chrome
 *      profilindeki store kopyası).
 *   3. Launcher sayfasını açar → extension o worker'ın bridge'ine bağlanır.
 *
 * Bu mimari iki problemi birden çözer:
 *   - "Page agent bağlantısı kopup duruyor": kullanıcının kendi Chrome'una
 *     bağımlılık kalkar; her koşum kendi izole, kimsenin dokunmadığı
 *     tarayıcısında çalışır.
 *   - Paralellik: bridge tek-tenant'tır (tek hub); worker başına ayrı
 *     bridge + tarayıcı ile N case aynı anda koşabilir.
 *
 * Hata anında ekran görüntüsü: worker'ın tarayıcısındaki aktif test sekmesi
 * puppeteer üzerinden yakalanır (extension'ın screenshot komutuna bağımlı
 * değildir) ve screenshots tablosuna kaydedilir → rapor sayfasında görünür.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveScreenshot } from "../db/queries";

type Browser = import("puppeteer-core").Browser;

const EXT_ID = process.env.PAGE_AGENT_EXT_ID || "akldabonmimlicnjlflnapfeklbfemhj";
const BASE_PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401", 10);
const BRIDGE_STARTUP_TIMEOUT_MS = 25_000;
const HUB_CONNECT_TIMEOUT_MS = 30_000;
const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");
const LOGS_DIR = path.join(process.cwd(), "data", "logs");

/**
 * Extension yükleyebilen Chrome binary'sini bulur.
 *
 * ÖNEMLİ: Marka Google Chrome 137+'da --load-extension bayrağı KALDIRILDI —
 * extension sessizce yüklenmez. Otomasyon için "Chrome for Testing" gerekir:
 *   npx @puppeteer/browsers install chrome@stable
 * (proje kökündeki chrome/ dizinine iner; pool onu otomatik bulur.)
 */
function findChromeExecutable(): string {
  if (process.env.HEADLESS_CHROME_PATH && fs.existsSync(process.env.HEADLESS_CHROME_PATH)) {
    return process.env.HEADLESS_CHROME_PATH;
  }

  // Proje köküne @puppeteer/browsers ile indirilen Chrome for Testing
  const cftRoot = path.join(process.cwd(), "chrome");
  if (fs.existsSync(cftRoot)) {
    const versions = fs.readdirSync(cftRoot).filter((d) => !d.startsWith("."));
    versions.sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      const bin = path.join(
        cftRoot,
        versions[i],
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      );
      if (fs.existsSync(bin)) return bin;
    }
  }

  throw new Error(
    "Chrome for Testing bulunamadı. Marka Chrome 137+ --load-extension'ı desteklemediği " +
      "için headless mod Chrome for Testing gerektirir. Kurulum: " +
      "npx @puppeteer/browsers install chrome@stable " +
      "(veya HEADLESS_CHROME_PATH env değişkeniyle yol belirtin)"
  );
}

const LOCAL_EXT_DIR = path.join(process.cwd(), "data", "page-agent-ext");

function findProfileExtensionPath(): string | null {
  const profilesRoot = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  const profiles = ["Default", "Profile 1", "Profile 2", "Profile 3"];
  for (const profile of profiles) {
    const extRoot = path.join(profilesRoot, profile, "Extensions", EXT_ID);
    if (!fs.existsSync(extRoot)) continue;
    const versions = fs.readdirSync(extRoot).filter((v) => !v.startsWith("."));
    if (versions.length === 0) continue;
    versions.sort();
    return path.join(extRoot, versions[versions.length - 1]);
  }
  return null;
}

/**
 * Page Agent extension'ının headless Chrome'a yüklenecek yolunu döndürür.
 *
 * Store kopyasındaki _metadata (içerik doğrulama) klasörü --load-extension ile
 * yüklemede kararsızlığa yol açtığı için, profildeki kopya _metadata'sız olarak
 * data/page-agent-ext/ altına alınır ve oradan yüklenir.
 * Öncelik: PAGE_AGENT_EXT_PATH env → data/page-agent-ext → profilden kopyala.
 */
export function findExtensionPath(): string {
  if (process.env.PAGE_AGENT_EXT_PATH && fs.existsSync(process.env.PAGE_AGENT_EXT_PATH)) {
    return process.env.PAGE_AGENT_EXT_PATH;
  }

  if (fs.existsSync(path.join(LOCAL_EXT_DIR, "manifest.json"))) {
    return LOCAL_EXT_DIR;
  }

  const profileCopy = findProfileExtensionPath();
  if (profileCopy) {
    console.log(`[headless-pool] Extension yerel kopyaya alınıyor: ${LOCAL_EXT_DIR}`);
    fs.cpSync(profileCopy, LOCAL_EXT_DIR, { recursive: true });
    fs.rmSync(path.join(LOCAL_EXT_DIR, "_metadata"), { recursive: true, force: true });
    return LOCAL_EXT_DIR;
  }

  throw new Error(
    `Page Agent extension diskte bulunamadı (ID: ${EXT_ID}). ` +
      `Chrome'a extension'ı yükleyin veya PAGE_AGENT_EXT_PATH ile unpacked yolu verin.`
  );
}

async function probeStatus(base: string): Promise<{ ok: boolean; connected: boolean }> {
  try {
    const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { ok: false, connected: false };
    const d = (await res.json()) as { connected?: boolean };
    return { ok: true, connected: !!d.connected };
  } catch {
    return { ok: false, connected: false };
  }
}

export class HeadlessWorker {
  readonly id: number;
  readonly port: number;
  readonly bridgeBase: string;
  private bridgeProc: ChildProcess | null = null;
  private browser: Browser | null = null;
  private userDataDir: string;

  constructor(id: number) {
    this.id = id;
    // 38401 kullanıcının kendi bridge'ine ayrılmıştır; worker'lar +1'den başlar
    this.port = BASE_PORT + 1 + id;
    this.bridgeBase = `http://localhost:${this.port}`;
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `qa-agent-chrome-${id}-`));
  }

  async start(): Promise<void> {
    await this.startBridge();
    await this.startBrowser();
    await this.waitForHubConnected();
    console.log(`[headless-pool] ✅ Worker ${this.id} hazır (port ${this.port})`);
  }

  private async startBridge(): Promise<void> {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const logPath = path.join(LOGS_DIR, `bridge-${this.port}.out`);
    const out = fs.openSync(logPath, "a");

    this.bridgeProc = spawn("npm", ["run", "bridge"], {
      cwd: process.cwd(),
      env: { ...process.env, PAGE_AGENT_PORT: String(this.port) },
      stdio: ["ignore", out, out],
      detached: false,
    });

    const deadline = Date.now() + BRIDGE_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((await probeStatus(this.bridgeBase)).ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Worker ${this.id}: bridge ${this.port} portunda başlatılamadı (log: ${logPath})`);
  }

  private async startBrowser(): Promise<void> {
    const puppeteer = await import("puppeteer-core");
    const extPath = findExtensionPath();

    this.browser = await puppeteer.launch({
      executablePath: findChromeExecutable(),
      headless: true,
      userDataDir: this.userDataDir,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--window-size=1440,900",
      ],
    });

    await this.triggerOpenHub();
  }

  /**
   * Taze bir sekmede launcher'ı açarak extension'a OPEN_HUB mesajını gönderir.
   * Extension mesajı alınca bu sekmeyi kendi hub sayfasına yönlendirir ve WS
   * bağlantısı O SAYFADA yaşar — bu yüzden sekme asla kapatılmaz ve kopan
   * bağlantı eski sekme reload'uyla değil, hep yeni sekmeyle tetiklenir.
   */
  private async triggerOpenHub(): Promise<void> {
    if (!this.browser) return;
    try {
      const page = await this.browser.newPage();
      try {
        await page.goto(`${this.bridgeBase}/`, { waitUntil: "load", timeout: 10_000 });
      } catch (err) {
        const msg = (err as Error).message;
        // Yönlendirme kaynaklı detach normaldir — OPEN_HUB gitmiştir
        if (!/detached|destroyed|navigation/i.test(msg)) throw err;
      }
    } catch (err) {
      console.warn(
        `[headless-pool] Worker ${this.id}: launcher tetiklenemedi: ${(err as Error).message.slice(0, 80)}`
      );
    }
  }

  /**
   * Hub bağlantısını garanti eder — her case'ten önce çağrılır.
   * MV3 extension service worker'ları boşta kalınca askıya alınıp WS'i
   * düşürebiliyor ("bağlantı kopup duruyor" sorununun kök nedeni); kopmuşsa
   * launcher yenilenerek OPEN_HUB tekrar tetiklenir ve bağlantı kendi kendini
   * onarır.
   */
  async ensureConnected(timeoutMs = 20_000): Promise<void> {
    if ((await probeStatus(this.bridgeBase)).connected) return;
    console.log(
      `[headless-pool] Worker ${this.id}: hub bağlantısı kopmuş — launcher yenilenip yeniden bağlanılıyor...`
    );
    await this.waitForHubConnected(timeoutMs);
  }

  private async waitForHubConnected(timeoutMs = HUB_CONNECT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastTrigger = Date.now();
    while (Date.now() < deadline) {
      if ((await probeStatus(this.bridgeBase)).connected) return;
      // OPEN_HUB kaybolmuş olabilir (extension SW henüz hazır değildi ya da
      // hub sayfası öldü) — periyodik olarak TAZE sekmeyle tekrar tetikle
      if (Date.now() - lastTrigger > 4000) {
        lastTrigger = Date.now();
        await this.triggerOpenHub();
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `Worker ${this.id}: extension hub ${timeoutMs / 1000}s içinde bağlanmadı. ` +
        `Extension headless Chrome'a yüklenemedi olabilir (data/logs/bridge-${this.port}.out kontrol edin).`
    );
  }

  /**
   * Hata anında aktif test sekmesinin ekran görüntüsünü alır ve screenshots
   * tablosuna kaydeder — rapor sayfasında case'in yanında görünür.
   */
  async captureFailureScreenshot(testCaseId: string, runId: string): Promise<string | null> {
    if (!this.browser) return null;
    try {
      const pages = await this.browser.pages();
      // Launcher/boş sekmeleri ele; en son açılan gerçek sayfayı al
      const candidates = pages.filter((p) => {
        const u = p.url();
        return u && !u.startsWith("about:") && !u.startsWith(this.bridgeBase) && !u.startsWith("chrome");
      });
      const target = candidates[candidates.length - 1] ?? pages[pages.length - 1];
      if (!target) return null;

      const safeCaseId = testCaseId.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 80);
      const dir = path.join(SCREENSHOTS_DIR, safeCaseId);
      fs.mkdirSync(dir, { recursive: true });
      const stepIndex = Math.floor(Date.now() / 1000);
      const filename = `${stepIndex}-fail.png`;
      const absPath = path.join(dir, filename);

      await target.screenshot({ path: absPath as `${string}.png`, fullPage: false });

      const relPath = path.join("data", "screenshots", safeCaseId, filename);
      saveScreenshot(testCaseId, relPath, stepIndex, "fail", runId);
      console.log(`[headless-pool] 📸 Hata ekran görüntüsü kaydedildi: ${relPath}`);
      return relPath;
    } catch (err) {
      console.warn(
        `[headless-pool] Hata ekran görüntüsü alınamadı (worker ${this.id}): ${(err as Error).message}`
      );
      return null;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.browser?.close();
    } catch { /* ignore */ }
    this.browser = null;
    if (this.bridgeProc && !this.bridgeProc.killed) {
      try {
        this.bridgeProc.kill("SIGTERM");
      } catch { /* ignore */ }
    }
    this.bridgeProc = null;
    try {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

export interface HeadlessPool {
  workers: HeadlessWorker[];
  dispose(): Promise<void>;
}

/**
 * N worker'lı havuz kurar. Worker'lar SIRALI başlatılır — eşzamanlı Chrome
 * başlatmak extension service worker'larında yarış durumu yaratıyor (OPEN_HUB
 * mesajı kayboluyor). Herhangi biri başlatılamazsa kurulanlar temizlenir ve
 * hata fırlatılır (çağıran taraf legacy sıralı moda düşebilir).
 */
export async function createHeadlessPool(size: number): Promise<HeadlessPool> {
  const workers: HeadlessWorker[] = [];
  try {
    for (let i = 0; i < size; i++) {
      const worker = new HeadlessWorker(i);
      workers.push(worker);
      await worker.start();
    }
  } catch (err) {
    await Promise.allSettled(workers.map((w) => w.dispose()));
    throw new Error(`Headless havuz kurulamadı: ${(err as Error).message}`);
  }

  return {
    workers,
    async dispose() {
      await Promise.allSettled(workers.map((w) => w.dispose()));
    },
  };
}
