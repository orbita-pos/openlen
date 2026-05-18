import type { ElementSnapshot } from "../types";
import type { SpacingTokens } from "./types";

const PX_RE = /(-?\d+(?:\.\d+)?)px/g;

function extractAllPx(value: string, out: number[]): void {
  if (!value) return;
  let match: RegExpExecArray | null;
  while ((match = PX_RE.exec(value)) !== null) {
    const n = parseFloat(match[1]);
    if (n >= 4 && n <= 256) out.push(Math.round(n));
  }
  PX_RE.lastIndex = 0;
}

export function extractSpacing(elements: ElementSnapshot[]): SpacingTokens {
  const values: number[] = [];
  for (const el of elements) {
    extractAllPx(el.styles.padding, values);
    extractAllPx(el.styles.margin, values);
    extractAllPx(el.styles.gap, values);
  }

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  const top20 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([v]) => v);

  let bestBase: 4 | 6 | 8 = 4;
  let bestCount = -1;
  for (const candidate of [4, 6, 8] as const) {
    const c = top20.filter((v) => v % candidate === 0).length;
    if (c > bestCount) {
      bestCount = c;
      bestBase = candidate;
    }
  }

  const scaleByBase: Record<number, Record<string, number>> = {
    4: { "1": 4, "2": 8, "3": 12, "4": 16, "6": 24, "8": 32, "12": 48, "16": 64, "20": 80, "24": 96 },
    6: { "1": 6, "2": 12, "3": 18, "4": 24, "6": 36, "8": 48, "12": 72, "16": 96 },
    8: { "1": 8, "2": 16, "3": 24, "4": 32, "6": 48, "8": 64, "12": 96, "16": 128 },
  };

  return {
    base: bestBase,
    scale: scaleByBase[bestBase],
    detectedValues: top20,
  };
}
