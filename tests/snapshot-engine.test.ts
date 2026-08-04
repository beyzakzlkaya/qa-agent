import fs from "fs";
import path from "path";
import { makePng, solidPng } from "./helpers/png";

// ─── puppeteer-core mock ──────────────────────────────────────────────────────
// Gerçek Chrome açmadan capture akışını test eder: screenshot() çağrıları
// mockShotQueue'dan sırayla buffer tüketir.

const mockShotQueue: Buffer[] = [];
let mockLaunchImpl: (() => Promise<unknown>) | null = null;

function mockMakePage() {
  return {
    setViewport: jest.fn(async () => {}),
    goto: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
    evaluate: jest.fn(async (fn: () => unknown) => {
      const g = globalThis as Record<string, unknown>;
      g.window = {
        scrollBy: () => {},
        scrollTo: () => {},
        innerHeight: 900,
      };
      g.document = { body: { scrollHeight: 100 } };
      try {
        return await fn();
      } finally {
        delete g.window;
        delete g.document;
      }
    }),
    screenshot: jest.fn(async (opts?: { path?: string }) => {
      const buf = mockShotQueue.shift();
      if (!buf) throw new Error("Mock screenshot kuyruğu boş");
      if (opts?.path) fs.writeFileSync(opts.path, buf);
      return buf;
    }),
  };
}

function mockMakeBrowser() {
  return {
    newPage: jest.fn(async () => mockMakePage()),
    close: jest.fn(async () => {}),
  };
}

jest.mock("puppeteer-core", () => ({
  launch: jest.fn(async () => {
    if (mockLaunchImpl) return mockLaunchImpl();
    return mockMakeBrowser();
  }),
}));

// data/ dizinini bilerek OLUŞTURMUYORUZ — getDb'nin dizin yaratma dalını
// bu test dosyası kapsar. Sahte Chrome binary'si oluştur:
const fakeChrome = path.join(process.cwd(), "fake-chrome");
fs.writeFileSync(fakeChrome, "");
process.env.SNAPSHOT_CHROME_PATH = fakeChrome;

import * as q from "@/lib/db/queries";
import * as diffModule from "@/lib/screenshot-diff";
import {
  runSnapshotTargets,
  approveSnapshot,
  isSnapshotRunInProgress,
} from "@/lib/snapshot-engine";

const W = 120;
const H = 120;
const GRAY: [number, number, number] = [100, 100, 100];
const RED: [number, number, number] = [220, 30, 30];
const BLUE: [number, number, number] = [30, 30, 220];

/** Banner bölgesi (sol üst 40×40) farklı renkte olan görüntü. */
function withBanner(base: [number, number, number], banner: [number, number, number]): Buffer {
  return makePng(W, H, (x, y) => (x < 40 && y < 40 ? banner : base));
}

function queueShots(...bufs: Buffer[]): void {
  mockShotQueue.length = 0;
  mockShotQueue.push(...bufs);
}

const TARGET_ID = "engine-target";

beforeAll(() => {
  q.createSnapshotTarget({
    id: TARGET_ID,
    name: "Engine Test Hedefi",
    platform: "website",
    environment: "preprod",
    path: "/",
    threshold: 0.5,
  });
});

describe("runSnapshotTargets", () => {
  it("koşum yokken isSnapshotRunInProgress false döner", () => {
    expect(isSnapshotRunInProgress()).toBe(false);
  });

  it("ilk koşumda baseline oluşturur (new)", async () => {
    const gray = solidPng(W, H, GRAY);
    queueShots(gray, gray, gray);

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("new");
    expect(outcome.error).toBeUndefined();

    const target = q.getSnapshotTarget(TARGET_ID)!;
    expect(target.baseline_path).toBeTruthy();
    expect(fs.existsSync(path.join(process.cwd(), target.baseline_path!))).toBe(true);
    // current görüntü screenshots tablosuna da düşmüş olmalı
    expect(q.getScreenshots(`snap-${TARGET_ID}`).length).toBeGreaterThan(0);
  });

  it("baseline ile eşleşen koşum match döner", async () => {
    const gray = solidPng(W, H, GRAY);
    queueShots(gray, gray, gray);

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("match");
    expect(outcome.result?.diff_percentage).toBe(0);
  });

  it("gerçek değişiklik mismatch üretir ve diff haritası yazılır", async () => {
    const red = solidPng(W, H, RED);
    queueShots(red, red, red);

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("mismatch");
    expect(outcome.result?.diff_percentage).toBeGreaterThan(0.5);
    expect(outcome.result?.diff_path).toBeTruthy();
    expect(fs.existsSync(path.join(process.cwd(), outcome.result!.diff_path!))).toBe(true);
  });

  it("approveSnapshot mismatch'i yeni baseline yapar (jest -u)", async () => {
    const mismatch = q.listSnapshotResults(TARGET_ID, 1)[0];
    expect(mismatch.status).toBe("mismatch");

    const approved = approveSnapshot(mismatch.id);
    expect(approved.status).toBe("updated");

    // Artık kırmızı görüntü baseline — kırmızı koşum match olmalı
    const red = solidPng(W, H, RED);
    queueShots(red, red, red);
    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("match");
  });

  it("koşum içinde kendiliğinden değişen bölge (banner) maskelenir → match", async () => {
    // Banner bölgesi örnekler arasında değişiyor; sayfanın kalanı baseline (kırmızı) ile aynı
    queueShots(
      withBanner(RED, GRAY),
      withBanner(RED, BLUE),
      withBanner(RED, GRAY)
    );

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("match");
    expect(outcome.result?.masked_percentage).toBeGreaterThan(0);
    expect(outcome.result?.diff_percentage).toBe(0);
  });

  it("bilinmeyen hedef için error outcome döner", async () => {
    const [outcome] = await runSnapshotTargets(["boyle-bir-hedef-yok"]);
    expect(outcome.result).toBeNull();
    expect(outcome.error).toContain("Hedef bulunamadı");
  });

  it("capture hatasında error sonucu kaydedilir, koşum devam eder", async () => {
    queueShots(); // boş kuyruk → screenshot throw eder

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("error");
    expect(outcome.result?.error_message).toContain("kuyruğu boş");
  });

  it("boyut uyuşmazlığı hatasını mismatch olarak kaydeder", async () => {
    const spy = jest
      .spyOn(diffModule, "compareScreenshots")
      .mockRejectedValueOnce(new Error("Image sizes do not match."));
    const red = solidPng(W, H, RED);
    queueShots(red, red, red);

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("mismatch");
    expect(outcome.result?.diff_percentage).toBe(100);
    expect(outcome.result?.error_message).toContain("boyut");
    spy.mockRestore();
  });

  it("beklenmedik karşılaştırma hatası error sonucu üretir", async () => {
    const spy = jest
      .spyOn(diffModule, "compareScreenshots")
      .mockRejectedValueOnce(new Error("disk dolu"));
    const red = solidPng(W, H, RED);
    queueShots(red, red, red);

    const [outcome] = await runSnapshotTargets([TARGET_ID]);
    expect(outcome.result?.status).toBe("error");
    expect(outcome.result?.error_message).toBe("disk dolu");
    spy.mockRestore();
  });

  it("devam eden koşum varken ikinci koşum reddedilir", async () => {
    let releaseLaunch!: (v: unknown) => void;
    mockLaunchImpl = () => new Promise((resolve) => { releaseLaunch = resolve; });

    const first = runSnapshotTargets([TARGET_ID]);
    await expect(runSnapshotTargets([TARGET_ID])).rejects.toThrow("Zaten devam eden");

    // İlk koşumu serbest bırak ve temiz bitir
    const red = solidPng(W, H, RED);
    queueShots(red, red, red);
    releaseLaunch(mockMakeBrowser());
    mockLaunchImpl = null;
    await first;
    expect(isSnapshotRunInProgress()).toBe(false);
  });
});

describe("hedef URL varyantları ve env varsayılanları", () => {
  it("path'i / ile başlamayan hedef de doğru URL'e gider (new baseline)", async () => {
    q.createSnapshotTarget({
      id: "engine-target-2",
      name: "Kategori sayfası",
      platform: "backoffice",
      environment: "prod",
      path: "kategori/telefon",
      threshold: 1,
    });
    const gray = solidPng(W, H, GRAY);
    queueShots(gray, gray, gray);

    const [outcome] = await runSnapshotTargets(["engine-target-2"]);
    expect(outcome.result?.status).toBe("new");
  });

  it("bekleme süresi env değişkenleri yokken modül varsayılanlarla yüklenir", () => {
    const saved = {
      settle: process.env.SNAPSHOT_SETTLE_MS,
      sample: process.env.SNAPSHOT_SAMPLE_INTERVAL_MS,
      scroll: process.env.SNAPSHOT_SCROLL_SETTLE_MS,
    };
    delete process.env.SNAPSHOT_SETTLE_MS;
    delete process.env.SNAPSHOT_SAMPLE_INTERVAL_MS;
    delete process.env.SNAPSHOT_SCROLL_SETTLE_MS;
    expect(() => {
      jest.isolateModules(() => {
        require("@/lib/snapshot-engine");
      });
    }).not.toThrow();
    process.env.SNAPSHOT_SETTLE_MS = saved.settle;
    process.env.SNAPSHOT_SAMPLE_INTERVAL_MS = saved.sample;
    process.env.SNAPSHOT_SCROLL_SETTLE_MS = saved.scroll;
  });
});

describe("boş veritabanı durumları (bu dosyanın DB'sinde hiç run yok)", () => {
  it("getRunsSummary sıfır durumunda tüm alanlar 0 döner", () => {
    const s = q.getRunsSummary();
    expect(s.totalRuns).toBe(0);
    expect(s.passedRuns).toBe(0);
    expect(s.failedRuns).toBe(0);
    expect(s.partialRuns).toBe(0);
    expect(s.runningRuns).toBe(0);
    expect(s.totalCases).toBe(0);
    expect(s.caseSuccessRate).toBe(0);
    expect(s.runSuccessRate).toBe(0);
  });

  it("trend/health sorguları boş dizi döner", () => {
    expect(q.getDailyTrend()).toEqual([]);
    expect(q.getRecentRunOutcomes()).toEqual([]);
    expect(q.getTestCaseHealth()).toEqual([]);
  });
});

describe("approveSnapshot hata yolları", () => {
  it("olmayan sonuç id'si için fırlatır", () => {
    expect(() => approveSnapshot(999999)).toThrow("Sonuç bulunamadı");
  });

  it("current görüntüsü olmayan sonuç için fırlatır", () => {
    const r = q.insertSnapshotResult({ targetId: TARGET_ID, status: "error" });
    expect(() => approveSnapshot(r.id)).toThrow("güncel görüntü yok");
  });

  it("current dosyası diskten silinmişse fırlatır", () => {
    const r = q.insertSnapshotResult({
      targetId: TARGET_ID,
      status: "mismatch",
      currentPath: "data/screenshots/olmayan.png",
    });
    expect(() => approveSnapshot(r.id)).toThrow("diskte yok");
  });
});
