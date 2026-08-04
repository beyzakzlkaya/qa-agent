/**
 * lib/snapshot-engine/index.ts
 *
 * Jest tarzı görsel snapshot testing motoru.
 * https://jestjs.io/docs/snapshot-testing modelinin QA Agent'a uyarlaması:
 *
 *   Jest                          →  QA Agent
 *   ────────────────────────────────────────────────────────────────
 *   toMatchSnapshot() ilk koşum   →  baseline ekran görüntüsü kaydedilir ("new")
 *   sonraki koşumlar              →  pixelmatch ile baseline karşılaştırması
 *   eşleşme                       →  "match" (test geçti)
 *   fark                          →  "mismatch" (test kaldı) + diff görüntüsü
 *   jest -u / --updateSnapshot    →  approveSnapshot() → baseline güncellenir ("updated")
 *
 * Yakalama: puppeteer-core + sistemde kurulu Chrome (headless, sabit viewport).
 * Bridge/extension'a bağımlı DEĞİL — snapshot karşılaştırması deterministik
 * olmalı; kullanıcının pencere boyutuna bağlı extension görüntüsü bunun için
 * uygun değil. SNAPSHOT_CHROME_PATH env değişkeni ile Chrome yolu ezilebilir.
 */

import fs from "fs";
import path from "path";
import { getUrl, type Environment } from "../config/environments";
import type { Platform } from "../types";
import { compareScreenshots, computeDynamicMask, type DynamicMask } from "../screenshot-diff";
import {
  getSnapshotTarget,
  setSnapshotBaseline,
  insertSnapshotResult,
  getSnapshotResult,
  updateSnapshotResultStatus,
  saveScreenshot,
  type SnapshotTargetRow,
  type SnapshotResultRow,
} from "../db/queries";

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");
const BASELINES_DIR = path.join(SCREENSHOTS_DIR, "snapshot-baselines");

/** Deterministik karşılaştırma için sabit viewport. */
const VIEWPORT = { width: 1440, height: 900 };
/** Sayfa yüklendikten sonra animasyon/lazy içerik için ek bekleme. */
const PAGE_SETTLE_MS = parseInt(process.env.SNAPSHOT_SETTLE_MS ?? "2500", 10);
const NAV_TIMEOUT_MS = 45_000;
/**
 * Dinamik alan tespiti: bu aralıkla 3 örnek alınır; örnekler arasında
 * kendiliğinden değişen bölgeler (süreli banner geçişleri, karüseller)
 * maskelenip karşılaştırma dışı bırakılır. ~7s'ye kadar döngüleri yakalar.
 */
const DYNAMIC_SAMPLE_INTERVAL_MS = parseInt(
  process.env.SNAPSHOT_SAMPLE_INTERVAL_MS ?? "3500",
  10
);
/** Scroll sonrası başa dönünce sticky header/animasyonların oturma beklemesi. */
const SCROLL_SETTLE_MS = parseInt(process.env.SNAPSHOT_SCROLL_SETTLE_MS ?? "1000", 10);

export interface SnapshotRunOutcome {
  targetId: string;
  targetName: string;
  result: SnapshotResultRow | null;
  error?: string;
}

// Aynı anda tek koşum — tek Chrome instance'ı yönetiyoruz
let runInProgress = false;

export function isSnapshotRunInProgress(): boolean {
  return runInProgress;
}

function targetUrl(target: SnapshotTargetRow): string {
  const root = getUrl(target.environment as Environment, target.platform as Platform);
  const p = target.path.startsWith("/") ? target.path.slice(1) : target.path;
  return root.endsWith("/") ? `${root}${p}` : `${root}/${p}`;
}

function findChromeExecutable(): string {
  const candidates = [
    process.env.SNAPSHOT_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "Chrome bulunamadı. SNAPSHOT_CHROME_PATH env değişkeni ile Chrome yolunu belirtin."
  );
}

type Browser = import("puppeteer-core").Browser;

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  return puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });
}

/**
 * Lazy-load içerikleri tetiklemek için sayfayı adım adım en alta kadar
 * scroll eder, sonra başa döner.
 */
async function autoScrollToBottom(page: import("puppeteer-core").Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const step = 600;
      let scrolled = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        scrolled += step;
        // scrollHeight her adımda yeniden okunur — lazy içerik yüklendikçe büyür
        if (scrolled >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  // Başa dönünce sticky header/animasyonların oturması için kısa bekleme
  await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));
}

interface CaptureOutput {
  relPath: string;
  mask: DynamicMask;
}

/**
 * Hedef sayfanın TAM SAYFA ekran görüntüsünü alır; kaydedilen PNG'nin proje
 * köküne göre relative yolunu döndürür. screenshots tablosuna da kayıt düşer.
 *
 * Süreli banner geçişlerini yakalayıp maskeleyebilmek için 3.5s arayla
 * 3 örnek alınır; sonuncusu asıl görüntü olur, örnekler arası kendiliğinden
 * değişen bölgelerden dinamik maske üretilir.
 */
async function captureSnapshot(browser: Browser, target: SnapshotTargetRow): Promise<CaptureOutput> {
  const url = targetUrl(target);
  const page = await browser.newPage();
  try {
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, PAGE_SETTLE_MS));
    await autoScrollToBottom(page);

    const caseId = `snap-${target.id}`;
    const dir = path.join(SCREENSHOTS_DIR, caseId);
    fs.mkdirSync(dir, { recursive: true });
    const stepIndex = Math.floor(Date.now() / 1000);
    const filename = `${stepIndex}-snapshot.png`;
    const absPath = path.join(dir, filename);

    const sample1 = (await page.screenshot({ fullPage: true })) as Buffer;
    await new Promise((r) => setTimeout(r, DYNAMIC_SAMPLE_INTERVAL_MS));
    const sample2 = (await page.screenshot({ fullPage: true })) as Buffer;
    await new Promise((r) => setTimeout(r, DYNAMIC_SAMPLE_INTERVAL_MS));
    await page.screenshot({ path: absPath as `${string}.png`, fullPage: true });

    const finalBuffer = fs.readFileSync(absPath);
    const mask = await computeDynamicMask([sample1, sample2, finalBuffer]);

    const relPath = path.join("data", "screenshots", caseId, filename);
    saveScreenshot(caseId, relPath, stepIndex, "snapshot");
    return { relPath, mask };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Tek hedef için snapshot testi koşar (Jest'teki tek bir toMatchSnapshot() gibi):
 *  - baseline yoksa: current → baseline kopyalanır, status "new"
 *  - baseline varsa: pixelmatch karşılaştırması → "match" | "mismatch"
 */
async function runSingleTarget(
  browser: Browser,
  target: SnapshotTargetRow
): Promise<SnapshotResultRow> {
  const { relPath: currentRelPath, mask } = await captureSnapshot(browser, target);
  const currentAbsPath = path.join(process.cwd(), currentRelPath);

  // İlk koşum: baseline yaz (Jest'in ilk .snap dosyası yazması)
  if (!target.baseline_path || !fs.existsSync(path.join(process.cwd(), target.baseline_path))) {
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
    const baselineRelPath = path.join(
      "data", "screenshots", "snapshot-baselines", `${target.id}.png`
    );
    fs.copyFileSync(currentAbsPath, path.join(process.cwd(), baselineRelPath));
    setSnapshotBaseline(target.id, baselineRelPath);
    return insertSnapshotResult({
      targetId: target.id,
      status: "new",
      currentPath: currentRelPath,
      baselinePath: baselineRelPath,
    });
  }

  const baselineAbsPath = path.join(process.cwd(), target.baseline_path);

  try {
    const diff = await compareScreenshots(currentAbsPath, baselineAbsPath, mask);
    const diffRelPath = path.relative(process.cwd(), diff.diffImagePath);
    const matched = diff.diffPercentage <= target.threshold;
    return insertSnapshotResult({
      targetId: target.id,
      status: matched ? "match" : "mismatch",
      currentPath: currentRelPath,
      baselinePath: target.baseline_path,
      diffPath: diffRelPath,
      diffPixels: diff.diffPixels,
      diffPercentage: diff.diffPercentage,
      maskedPercentage: mask.maskedPercentage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // pixelmatch boyut uyuşmazlığında fırlatır — bu da görsel bir değişikliktir
    if (msg.toLowerCase().includes("size") || msg.includes("boyut")) {
      return insertSnapshotResult({
        targetId: target.id,
        status: "mismatch",
        currentPath: currentRelPath,
        baselinePath: target.baseline_path,
        diffPercentage: 100,
        errorMessage: `Görüntü boyutları farklı — ${msg}`,
      });
    }
    throw err;
  }
}

/**
 * Verilen hedefleri sırayla koşar. Bir hedefin hatası diğerlerini durdurmaz.
 */
export async function runSnapshotTargets(targetIds: string[]): Promise<SnapshotRunOutcome[]> {
  if (runInProgress) {
    throw new Error("Zaten devam eden bir snapshot koşumu var.");
  }
  runInProgress = true;
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();

    const outcomes: SnapshotRunOutcome[] = [];
    for (const id of targetIds) {
      const target = getSnapshotTarget(id);
      if (!target) {
        outcomes.push({ targetId: id, targetName: id, result: null, error: "Hedef bulunamadı" });
        continue;
      }
      try {
        const result = await runSingleTarget(browser, target);
        outcomes.push({ targetId: id, targetName: target.name, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const result = insertSnapshotResult({
          targetId: id,
          status: "error",
          errorMessage: msg,
        });
        outcomes.push({ targetId: id, targetName: target.name, result, error: msg });
      }
    }
    return outcomes;
  } finally {
    if (browser) await browser.close().catch(() => {});
    runInProgress = false;
  }
}

/**
 * jest --updateSnapshot karşılığı: mismatch sonucun "current" görüntüsünü
 * yeni baseline yapar ve sonucu "updated" olarak işaretler.
 */
export function approveSnapshot(resultId: number): SnapshotResultRow {
  const result = getSnapshotResult(resultId);
  if (!result) throw new Error("Sonuç bulunamadı");
  if (!result.current_path) throw new Error("Bu sonuçta güncel görüntü yok");

  const target = getSnapshotTarget(result.target_id);
  if (!target) throw new Error("Hedef bulunamadı");

  const currentAbs = path.join(process.cwd(), result.current_path);
  if (!fs.existsSync(currentAbs)) throw new Error("Güncel görüntü dosyası diskte yok");

  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  const baselineRelPath = path.join(
    "data", "screenshots", "snapshot-baselines", `${target.id}.png`
  );
  fs.copyFileSync(currentAbs, path.join(process.cwd(), baselineRelPath));
  setSnapshotBaseline(target.id, baselineRelPath);
  updateSnapshotResultStatus(resultId, "updated");

  return getSnapshotResult(resultId)!;
}
