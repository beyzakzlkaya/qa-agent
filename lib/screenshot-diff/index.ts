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

export async function compareScreenshots(
  current: string,
  baseline: string
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

  const [currentPng, baselinePng] = await Promise.all([
    readPng(current),
    readPng(baseline),
  ]);

  const { width, height } = currentPng;
  const diffPng = new PNG({ width, height });

  const diffPixels = pixelmatch(
    currentPng.data,
    baselinePng.data,
    diffPng.data,
    width,
    height,
    { threshold: 0.1 }
  );

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
