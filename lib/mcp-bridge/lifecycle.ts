/**
 * lib/mcp-bridge/lifecycle.ts
 *
 * Page Agent bridge (scripts/start-bridge.ts) için lazy lifecycle yöneticisi.
 * - `ensureBridgeRunning()` çağrıldığında:
 *     1. Bridge zaten 38401 portunda yanıt veriyorsa hiçbir şey yapma.
 *     2. Yanıt vermiyorsa `npm run bridge` child process'i spawn et.
 *     3. HTTP /status erişilebilir olana dek bekle (timeout 20 sn).
 * - Aynı anda birden fazla istek gelirse tek bir başlatma promise'i paylaşılır.
 * - Process kapanırken child de SIGTERM ile temizlenir.
 *
 * Not: Chrome extension'ın WebSocket bağlantısı `executor.waitForBridge`
 * tarafından zaten ayrıca polleniyor — bu modül sadece bridge SUNUCUSUNUN
 * ayakta olmasını garanti eder.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BRIDGE_PORT = parseInt(process.env.PAGE_AGENT_PORT || "38401", 10);
const BRIDGE_BASE = `http://localhost:${BRIDGE_PORT}`;
const STARTUP_TIMEOUT_MS = 20_000;
const LOG_PATH = path.join(process.cwd(), "data", "logs", "bridge.out");

let child: ChildProcess | null = null;
let startupPromise: Promise<void> | null = null;
let shutdownHooksRegistered = false;

async function probeBridgeStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForBridgeStatus(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeBridgeStatus()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Bridge ${timeoutMs}ms içinde başlatılamadı`);
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const stop = () => {
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("exit", stop);
}

function spawnBridge(): ChildProcess {
  // Append child stdout/stderr to data/logs/bridge.out — main dev log temiz kalsın
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  } catch {
    // ignore
  }
  const out = fs.openSync(LOG_PATH, "a");
  const err = fs.openSync(LOG_PATH, "a");

  const proc = spawn("npm", ["run", "bridge"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", out, err],
    detached: false,
  });

  proc.on("exit", (code, signal) => {
    console.log(`[lifecycle] bridge çıktı (code=${code} signal=${signal})`);
    if (child === proc) child = null;
  });
  proc.on("error", (e) => {
    console.error(`[lifecycle] bridge spawn hatası:`, e);
  });

  return proc;
}

/**
 * Bridge'in ayakta olduğunu garanti et. Yoksa spawn et, status responding olana
 * kadar bekle. Aynı anda birden fazla çağrı tek startup'ı paylaşır.
 */
export async function ensureBridgeRunning(): Promise<void> {
  // Hızlı yol: zaten ayakta
  if (await probeBridgeStatus()) return;

  // Eşzamanlı çağrılar tek startup'ı paylaşır
  if (startupPromise) return startupPromise;

  startupPromise = (async () => {
    try {
      // Daha önce spawn ettiğimiz çocuk hâlâ takılı kalmışsa öldür
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        child = null;
      }

      console.log(`[lifecycle] bridge ayakta değil, spawn ediliyor (log: ${LOG_PATH})`);
      child = spawnBridge();
      registerShutdownHooks();

      await waitForBridgeStatus(STARTUP_TIMEOUT_MS);
      console.log(`[lifecycle] bridge hazır (PID ${child.pid})`);
    } finally {
      startupPromise = null;
    }
  })();

  return startupPromise;
}

/** Test/debug için manuel durdurma. Normal akışta gerek yok. */
export function stopBridge(): void {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    child = null;
  }
}

/** Bridge child process'inin durumu — UI/debug için. */
export function getBridgeLifecycleState(): {
  managed: boolean;
  pid?: number;
  killed: boolean;
} {
  return {
    managed: child !== null,
    pid: child?.pid,
    killed: child?.killed ?? false,
  };
}
