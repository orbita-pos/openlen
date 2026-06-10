// Derive a readable world from a user-uploaded backdrop image.
//
// The fear this kills: "subo un fondo verde y la letra es verde". The image
// only contributes TWO facts — its dominant saturated hue (the accent seed)
// and its average luminance (light or dark world). Everything readable is
// then built by lookFromAccent (the Looks seed engine), which walks
// lightness until fg/bg clears WCAG AA — so whatever the photo looks like,
// the derived ink can't collide with the derived grounds, and the scrim
// seats the text on the photo itself.
//
// Pure pixel math lives in deriveWorldFromPixels (unit-testable, no DOM);
// deriveWorldFromFile is the thin browser wrapper (canvas downsample of the
// LOCAL file — no CORS, the user just picked it).
//
// Client-safe: no node imports.

export interface DerivedWorld {
  /** Ink direction: dark image → dark world (light text), and vice versa. */
  mode: "light" | "dark";
  /** Dominant saturated color — the lookFromAccent seed. */
  accent: string;
}

const HUE_BUCKETS = 12;
/** Chroma floor for a pixel to vote on the accent (0-1 scale). */
const MIN_CHROMA = 0.12;
/** Grayscale images produce no votes — fall back to a quiet slate. */
export const FALLBACK_ACCENT = "#64748b";

/** Analyze an RGBA pixel buffer (any size — caller downsamples). */
export function deriveWorldFromPixels(data: Uint8ClampedArray): DerivedWorld {
  let lumSum = 0;
  let count = 0;
  const weight = new Array<number>(HUE_BUCKETS).fill(0);
  const sumR = new Array<number>(HUE_BUCKETS).fill(0);
  const sumG = new Array<number>(HUE_BUCKETS).fill(0);
  const sumB = new Array<number>(HUE_BUCKETS).fill(0);

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // transparent
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count++;

    const chroma = max - min;
    if (chroma < MIN_CHROMA) continue;
    // Skip near-black/near-white pixels — they read as shadow/highlight,
    // not as the image's color identity.
    const light = (max + min) / 2;
    if (light < 0.12 || light > 0.92) continue;

    let hue: number;
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    const bucket = Math.min(HUE_BUCKETS - 1, Math.floor((hue / 6) * HUE_BUCKETS));
    // Weight by chroma so a vivid sliver can outvote a washed expanse.
    weight[bucket] += chroma;
    sumR[bucket] += r * chroma;
    sumG[bucket] += g * chroma;
    sumB[bucket] += b * chroma;
  }

  const avgLum = count ? lumSum / count : 0.5;
  const mode: "light" | "dark" = avgLum < 0.45 ? "dark" : "light";

  let best = 0;
  for (let i = 1; i < HUE_BUCKETS; i++) if (weight[i] > weight[best]) best = i;
  if (weight[best] <= 0) return { mode, accent: FALLBACK_ACCENT };

  const w = weight[best];
  const hex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return {
    mode,
    accent: `#${hex(sumR[best] / w)}${hex(sumG[best] / w)}${hex(sumB[best] / w)}`,
  };
}

const SAMPLE_SIZE = 64;

function analyzeDrawable(
  source: CanvasImageSource,
  width: number,
  height: number,
): DerivedWorld {
  const scale = SAMPLE_SIZE / Math.max(width, height, 1);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { mode: "light", accent: FALLBACK_ACCENT };
  ctx.drawImage(source, 0, 0, w, h);
  return deriveWorldFromPixels(ctx.getImageData(0, 0, w, h).data);
}

/** Browser wrapper for a hosted image (the project's logo). Loads through an
 *  <img> element so SVG logos decode too. Callers must pass a same-origin,
 *  data: or proxied URL — cross-origin pixels would taint the canvas. */
export async function deriveWorldFromUrl(url: string): Promise<DerivedWorld> {
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
  // SVGs without intrinsic dimensions report 0×0 — rasterize at sample size.
  return analyzeDrawable(
    img,
    img.naturalWidth || SAMPLE_SIZE,
    img.naturalHeight || SAMPLE_SIZE,
  );
}

/** Browser wrapper: downsample the just-picked local file and analyze it.
 *  Local file → no canvas taint, no CORS, no proxy needed. */
export async function deriveWorldFromFile(file: Blob): Promise<DerivedWorld> {
  const bitmap = await createImageBitmap(file);
  try {
    return analyzeDrawable(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
