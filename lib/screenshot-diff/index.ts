/**
 * lib/screenshot-diff/index.ts
 *
 * Optional visual regression testing via pixel-level comparison.
 * Activated only when --with-baseline flag is used.
 *
 * Requires: pixelmatch, pngjs
 */

import fs from "fs";
import path from "path";

const DIFFS_DIR = path.join(process.cwd(), "data", "screenshots", "diffs");

export interface DiffResult {
  diffPixels: number;
  diffPercentage: number;
  diffImagePath: string;
}

/**
 * Hücre bazlı dinamik alan maskesi. cells[row*cols+col] = 1 → o hücre
 * karşılaştırma dışı (banner geçişi gibi kendiliğinden değişen bölge).
 */
export interface DynamicMask {
  cellSize: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  maskedPercentage: number;
}

/**
 * Aynı sayfadan kısa aralıklarla alınmış örnek görüntüleri karşılaştırıp
 * kendiliğinden değişen bölgeleri (süreli banner/karüsel geçişleri) tespit
 * eder. Ardışık her örnek çifti arasındaki farklar maske olarak birleştirilir.
 */
export async function computeDynamicMask(
  samples: Buffer[],
  cellSize = 40
): Promise<DynamicMask> {
  const { PNG } = await import("pngjs");
  const pngs = samples.map((b) => PNG.sync.read(b));

  const maxW = Math.max(...pngs.map((p) => p.width));
  const maxH = Math.max(...pngs.map((p) => p.height));
  const minW = Math.min(...pngs.map((p) => p.width));
  const minH = Math.min(...pngs.map((p) => p.height));

  const cols = Math.ceil(maxW / cellSize);
  const rows = Math.ceil(maxH / cellSize);
  const cells = new Uint8Array(cols * rows);

  // Ardışık örnek çiftlerini karşılaştır (2 piksel adımla — hız için yeterli)
  for (let s = 0; s < pngs.length - 1; s++) {
    const a = pngs[s];
    const b = pngs[s + 1];
    for (let y = 0; y < minH; y += 2) {
      for (let x = 0; x < minW; x += 2) {
        const ia = (y * a.width + x) * 4;
        const ib = (y * b.width + x) * 4;
        const delta =
          Math.abs(a.data[ia] - b.data[ib]) +
          Math.abs(a.data[ia + 1] - b.data[ib + 1]) +
          Math.abs(a.data[ia + 2] - b.data[ib + 2]);
        if (delta > 60) {
          cells[Math.floor(y / cellSize) * cols + Math.floor(x / cellSize)] = 1;
        }
      }
    }
  }

  // Örnekler arasında sayfa yüksekliği değiştiyse o bölge de oynak demektir
  if (maxH > minH) {
    for (let row = Math.floor(minH / cellSize); row < rows; row++) {
      for (let col = 0; col < cols; col++) cells[row * cols + col] = 1;
    }
  }

  let masked = 0;
  for (let i = 0; i < cells.length; i++) masked += cells[i];
  const maskedPercentage =
    cells.length > 0 ? Math.round((masked / cells.length) * 10000) / 100 : 0;

  return { cellSize, cols, rows, cells, maskedPercentage };
}

export async function compareScreenshots(
  current: string,
  baseline: string,
  mask?: DynamicMask
): Promise<DiffResult> {
  // Dynamic imports to avoid loading these modules if not needed
  let PNG: typeof import("pngjs").PNG;
  let pixelmatch: typeof import("pixelmatch");

  try {
    const pngjsModule = await import("pngjs");
    PNG = pngjsModule.PNG;
    const pixelmatchModule = await import("pixelmatch");
    pixelmatch = pixelmatchModule.default ?? (pixelmatchModule as unknown as typeof import("pixelmatch"));
  } catch {
    throw new Error(
      "pixelmatch veya pngjs yüklü değil. npm install pixelmatch pngjs @types/pngjs çalıştırın."
    );
  }

  const readPng = (filePath: string): Promise<InstanceType<typeof PNG>> => {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath).pipe(new PNG());
      stream.on("parsed", function (this: InstanceType<typeof PNG>) {
        resolve(this);
      });
      stream.on("error", reject);
    });
  };

  const [currentPngRaw, baselinePngRaw] = await Promise.all([
    readPng(current),
    readPng(baseline),
  ]);

  // pixelmatch aynı boyut ister. Tam sayfa görüntülerde yükseklik koşudan
  // koşuya değişebilir — küçük olanı beyaz tuvale yerleştirerek ortak boyuta
  // getiriyoruz; eksik alan doğal olarak fark sayılır.
  const width = Math.max(currentPngRaw.width, baselinePngRaw.width);
  const height = Math.max(currentPngRaw.height, baselinePngRaw.height);

  const padToCanvas = (src: InstanceType<typeof PNG>): InstanceType<typeof PNG> => {
    if (src.width === width && src.height === height) return src;
    const canvas = new PNG({ width, height });
    canvas.data.fill(255); // beyaz zemin
    PNG.bitblt(src, canvas, 0, 0, src.width, src.height, 0, 0);
    return canvas;
  };

  const currentPng = padToCanvas(currentPngRaw);
  const baselinePng = padToCanvas(baselinePngRaw);

  // Dinamik maske: maskeli hücreleri her iki görüntüde de aynı gri ile doldur
  // → o bölgeler karşılaştırmada fark üretmez
  if (mask) {
    const fillCell = (png: InstanceType<typeof PNG>, cx: number, cy: number) => {
      const x0 = cx * mask.cellSize;
      const y0 = cy * mask.cellSize;
      const x1 = Math.min(x0 + mask.cellSize, width);
      const y1 = Math.min(y0 + mask.cellSize, height);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          png.data[i] = 128;
          png.data[i + 1] = 128;
          png.data[i + 2] = 128;
          png.data[i + 3] = 255;
        }
      }
    };
    for (let row = 0; row < mask.rows; row++) {
      for (let col = 0; col < mask.cols; col++) {
        if (mask.cells[row * mask.cols + col]) {
          fillCell(currentPng, col, row);
          fillCell(baselinePng, col, row);
        }
      }
    }
  }

  const diffPng = new PNG({ width, height });

  const diffPixels = pixelmatch(
    currentPng.data,
    baselinePng.data,
    diffPng.data,
    width,
    height,
    { threshold: 0.1 }
  );

  // Diff görüntüsünde maskeli bölgeleri açık mavi tonla işaretle (görünürlük)
  if (mask) {
    for (let row = 0; row < mask.rows; row++) {
      for (let col = 0; col < mask.cols; col++) {
        if (!mask.cells[row * mask.cols + col]) continue;
        const x0 = col * mask.cellSize;
        const y0 = row * mask.cellSize;
        const x1 = Math.min(x0 + mask.cellSize, width);
        const y1 = Math.min(y0 + mask.cellSize, height);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            diffPng.data[i] = 205;
            diffPng.data[i + 1] = 225;
            diffPng.data[i + 2] = 255;
            diffPng.data[i + 3] = 255;
          }
        }
      }
    }
  }

  const totalPixels = width * height;
  const diffPercentage = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;

  fs.mkdirSync(DIFFS_DIR, { recursive: true });
  const diffFilename = `diff-${Date.now()}.png`;
  const diffImagePath = path.join(DIFFS_DIR, diffFilename);

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(diffImagePath);
    diffPng.pack().pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
  });

  return {
    diffPixels,
    diffPercentage: Math.round(diffPercentage * 100) / 100,
    diffImagePath,
  };
}
