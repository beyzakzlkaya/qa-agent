import fs from "fs";
import path from "path";
import {
  compareScreenshots,
  computeDynamicMask,
} from "@/lib/screenshot-diff";
import { makePng, solidPng } from "./helpers/png";

const W = 120;
const H = 120;

function writeTmpPng(name: string, buf: Buffer): string {
  const p = path.join(process.cwd(), name);
  fs.writeFileSync(p, buf);
  return p;
}

describe("computeDynamicMask", () => {
  it("özdeş örneklerde hiçbir hücre maskelenmez", async () => {
    const a = solidPng(W, H, [50, 50, 50]);
    const mask = await computeDynamicMask([a, a, a], 40);
    expect(mask.maskedPercentage).toBe(0);
    expect(Array.from(mask.cells).every((c) => c === 0)).toBe(true);
    expect(mask.cols).toBe(Math.ceil(W / 40));
    expect(mask.rows).toBe(Math.ceil(H / 40));
  });

  it("örnekler arasında değişen bölge maskelenir", async () => {
    const a = solidPng(W, H, [50, 50, 50]);
    // Sol üst 40x40 bölge farklı → o hücre dinamik
    const b = makePng(W, H, (x, y) =>
      x < 40 && y < 40 ? [250, 0, 0] : [50, 50, 50]
    );
    const mask = await computeDynamicMask([a, b], 40);
    expect(mask.cells[0]).toBe(1);
    expect(mask.maskedPercentage).toBeGreaterThan(0);
    // Değişmeyen bir hücre maskelenmemiş olmalı
    expect(mask.cells[mask.cells.length - 1]).toBe(0);
  });

  it("örnekler arasında yükseklik farkı varsa alt bölge maskelenir", async () => {
    const short = solidPng(W, 80, [50, 50, 50]);
    const tall = solidPng(W, H, [50, 50, 50]);
    const mask = await computeDynamicMask([short, tall], 40);
    // 80px sonrası satırlar (row 2) maskeli olmalı
    const lastRowStart = 2 * mask.cols;
    for (let c = 0; c < mask.cols; c++) {
      expect(mask.cells[lastRowStart + c]).toBe(1);
    }
  });

  it("varsayılan hücre boyutuyla da çalışır", async () => {
    const a = solidPng(50, 50, [10, 10, 10]);
    const mask = await computeDynamicMask([a, a]);
    expect(mask.cellSize).toBe(40);
    expect(mask.maskedPercentage).toBe(0);
  });
});

describe("compareScreenshots", () => {
  it("özdeş görüntülerde %0 fark döner ve diff görüntüsü yazılır", async () => {
    const buf = solidPng(W, H, [100, 100, 100]);
    const cur = writeTmpPng("cur-same.png", buf);
    const base = writeTmpPng("base-same.png", buf);

    const result = await compareScreenshots(cur, base);
    expect(result.diffPixels).toBe(0);
    expect(result.diffPercentage).toBe(0);
    expect(fs.existsSync(result.diffImagePath)).toBe(true);
  });

  it("farklı görüntülerde fark tespit eder", async () => {
    const cur = writeTmpPng("cur-diff.png", solidPng(W, H, [100, 100, 100]));
    const base = writeTmpPng("base-diff.png", solidPng(W, H, [200, 30, 30]));

    const result = await compareScreenshots(cur, base);
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffPercentage).toBeGreaterThan(50);
  });

  it("farklı boyutlarda küçük görüntüyü tuvale yerleştirip karşılaştırır (throw etmez)", async () => {
    const cur = writeTmpPng("cur-size.png", solidPng(W, H, [100, 100, 100]));
    const base = writeTmpPng("base-size.png", solidPng(W, 60, [100, 100, 100]));

    const result = await compareScreenshots(cur, base);
    // Padding bölgesi (60px altı) fark üretir
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffPercentage).toBeLessThan(100);
  });

  it("maske verilen bölgedeki farkı yok sayar", async () => {
    // Fark sadece sol üst 40x40 hücrede
    const cur = writeTmpPng(
      "cur-mask.png",
      makePng(W, H, (x, y) => (x < 40 && y < 40 ? [250, 0, 0] : [100, 100, 100]))
    );
    const base = writeTmpPng("base-mask.png", solidPng(W, H, [100, 100, 100]));

    // Maskesiz: fark var
    const noMask = await compareScreenshots(cur, base);
    expect(noMask.diffPixels).toBeGreaterThan(0);

    // Sol üst hücreyi maskeleyen mask
    const cols = Math.ceil(W / 40);
    const rows = Math.ceil(H / 40);
    const cells = new Uint8Array(cols * rows);
    cells[0] = 1;
    const masked = await compareScreenshots(cur, base, {
      cellSize: 40,
      cols,
      rows,
      cells,
      maskedPercentage: (1 / cells.length) * 100,
    });
    expect(masked.diffPixels).toBe(0);
  });
});
