import { differenceCiede2000, formatHex, oklch, parse, type Color } from "culori";

const dE = differenceCiede2000();

export interface ParsedColor {
  rgb: Color;
  oklch: { l: number; c: number; h: number };
  hex: string;
  alpha: number;
}

export function parseColor(input: string): ParsedColor | null {
  if (!input || input === "transparent") return null;
  const parsed = parse(input);
  if (!parsed) return null;
  const alpha = parsed.alpha ?? 1;
  if (alpha === 0) return null;

  const ok = oklch(parsed);
  if (!ok || ok.l === undefined || ok.c === undefined) return null;

  const hex = formatHex(parsed);
  if (!hex) return null;

  return {
    rgb: parsed,
    oklch: {
      l: ok.l,
      c: ok.c,
      h: ok.h ?? 0,
    },
    hex,
    alpha,
  };
}

export function deltaE(a: ParsedColor, b: ParsedColor): number {
  return dE(a.rgb, b.rgb);
}

export function isNearGrayscale(c: ParsedColor, chromaCutoff = 0.04): boolean {
  return c.oklch.c < chromaCutoff;
}

export function isHighSaturation(c: ParsedColor, chromaFloor = 0.08): boolean {
  return c.oklch.c >= chromaFloor;
}
