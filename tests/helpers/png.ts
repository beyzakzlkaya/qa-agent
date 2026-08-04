import { PNG } from "pngjs";

/**
 * Test PNG üretici: her pikselin rengini (x,y) → [r,g,b] fonksiyonu belirler.
 */
export function makePng(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number] = () => [10, 20, 30]
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = colorAt(x, y);
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** Tek renk PNG. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  return makePng(width, height, () => rgb);
}
