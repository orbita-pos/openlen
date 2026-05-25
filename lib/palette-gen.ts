// Algorithmic palette generator — produces coherent landing-page palettes
// from a named intent (or an accent seed). Pure function, no AI cost, no
// network. Used by:
//   - Inspector intent chips ("Cálido" / "Frío" / etc.) — fresh batch per click
//   - "Ver todos" modal grid (future) — infinite scroll of generated palettes
//
// Color math runs in OkLCH for perceptual uniformity (close hues = close
// perception), then formats to hex for the inspector.

import { formatHex, oklch, rgb } from "culori";
import type { Oklch } from "culori";
import type { Palette } from "./palettes";

function ok(l: number, c: number, h: number): Oklch {
  return { mode: "oklch", l, c, h };
}

export type PaletteIntent =
  | "warm"
  | "cool"
  | "sober"
  | "vibrant"
  | "pastel"
  | "dark"
  | "earth"
  | "jewel";

export const PALETTE_INTENTS: Array<{ id: PaletteIntent; label: string; hint: string }> = [
  { id: "warm",    label: "Cálido",   hint: "Naranjas, rojos, ámbares" },
  { id: "cool",    label: "Frío",     hint: "Azules, cianes, violetas" },
  { id: "sober",   label: "Sobrio",   hint: "Neutrales bajos en saturación" },
  { id: "vibrant", label: "Vibrante", hint: "Colores saturados, energéticos" },
  { id: "pastel",  label: "Pastel",   hint: "Tonos suaves, claros" },
  { id: "dark",    label: "Oscuro",   hint: "Fondos profundos, accents brillantes" },
  { id: "earth",   label: "Tierra",   hint: "Marrones, ocres, terracotas" },
  { id: "jewel",   label: "Joya",     hint: "Esmeralda, zafiro, rubí" },
];

// Hue ranges + LCH targets per intent. Each is a rough recipe — the generator
// picks N samples within the range and varies lightness/chroma for variety.
const RECIPES: Record<
  PaletteIntent,
  {
    hue: [number, number];
    accentL: [number, number];
    accentC: [number, number];
    bgL: [number, number];
    bgC: number;
    /** Dark-mode bias — when true, the bg is dark and the fg is light. */
    dark?: boolean;
  }
> = {
  warm:    { hue: [0, 60],      accentL: [0.58, 0.68], accentC: [0.13, 0.20], bgL: [0.96, 0.99], bgC: 0.01 },
  cool:    { hue: [200, 280],   accentL: [0.55, 0.65], accentC: [0.13, 0.20], bgL: [0.96, 0.99], bgC: 0.01 },
  sober:   { hue: [0, 360],     accentL: [0.45, 0.55], accentC: [0.04, 0.07], bgL: [0.96, 0.99], bgC: 0.005 },
  vibrant: { hue: [0, 360],     accentL: [0.60, 0.72], accentC: [0.18, 0.26], bgL: [0.97, 0.99], bgC: 0.01 },
  pastel:  { hue: [0, 360],     accentL: [0.75, 0.85], accentC: [0.08, 0.13], bgL: [0.98, 0.995], bgC: 0.005 },
  dark:    { hue: [0, 360],     accentL: [0.65, 0.75], accentC: [0.16, 0.22], bgL: [0.08, 0.16], bgC: 0.01, dark: true },
  earth:   { hue: [20, 60],     accentL: [0.45, 0.55], accentC: [0.08, 0.13], bgL: [0.95, 0.98], bgC: 0.015 },
  jewel:   { hue: [120, 280],   accentL: [0.40, 0.50], accentC: [0.15, 0.22], bgL: [0.97, 0.99], bgC: 0.005 },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Format OkLCH → #rrggbb. Clamps to sRGB gamut by reducing chroma if needed. */
function toHex(l: number, c: number, h: number): string {
  let chroma = c;
  for (let i = 0; i < 10; i++) {
    const candidate = rgb(ok(l, chroma, h));
    if (
      candidate &&
      candidate.r >= 0 &&
      candidate.r <= 1 &&
      candidate.g >= 0 &&
      candidate.g <= 1 &&
      candidate.b >= 0 &&
      candidate.b <= 1
    ) {
      return formatHex(candidate) ?? "#888888";
    }
    chroma *= 0.85;
  }
  return formatHex(rgb(ok(l, 0, h))) ?? "#888888";
}

/** Build one palette around a given accent hue + recipe. */
function buildOne(
  hue: number,
  recipe: typeof RECIPES[PaletteIntent],
  variant: number,
  name: string,
): Palette {
  const t = (variant % 5) / 4; // 0 .. 1
  const accentL = lerp(recipe.accentL[0], recipe.accentL[1], t);
  const accentC = lerp(recipe.accentC[0], recipe.accentC[1], t);
  const bgL = lerp(recipe.bgL[0], recipe.bgL[1], 1 - t);
  const isDark = !!recipe.dark;

  const accent = toHex(accentL, accentC, hue);
  const bg = toHex(bgL, recipe.bgC, hue);
  // Surface = slightly different lightness than bg (lifted in light, raised in dark)
  const surfaceL = isDark ? Math.min(0.22, bgL + 0.06) : Math.min(0.999, bgL + 0.02);
  const surface = toHex(surfaceL, recipe.bgC, hue);
  // Foreground = high contrast vs bg
  const fg = isDark
    ? toHex(0.95, 0.01, hue)
    : toHex(0.18, 0.02, hue);
  // Border = subtle, hued slightly toward accent
  const borderL = isDark ? Math.min(0.30, bgL + 0.14) : Math.max(0.85, bgL - 0.05);
  const border = toHex(borderL, isDark ? 0.02 : 0.015, hue);

  return {
    id: `gen-${name}`,
    name,
    hint: "",
    swatch: accent,
    tokens: {
      "--ol-bg": bg,
      "--ol-surface": surface,
      "--ol-fg": fg,
      "--ol-border": border,
      "--ol-accent": accent,
    },
  };
}

/** Generate `count` distinct palettes for an intent. Seed lets the caller
 *  reproduce a previous run (same seed + same intent + same count = same
 *  output). Without a seed, uses Math.random() for variety per click. */
export function generatePalettes(
  intent: PaletteIntent,
  count = 6,
  seed?: number,
): Palette[] {
  const recipe = RECIPES[intent];
  const out: Palette[] = [];
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 1_000_000));
  for (let i = 0; i < count; i++) {
    const hue = lerp(recipe.hue[0], recipe.hue[1], rng());
    const variant = Math.floor(rng() * 5);
    const name = `${intent.charAt(0).toUpperCase()}${intent.slice(1)} ${i + 1}`;
    out.push(buildOne(hue, recipe, variant, name));
  }
  return out;
}

/** Generate `count` palettes seeded from a specific accent color. Useful when
 *  the AI returns one brand accent and we want to derive 5-6 coherent palettes
 *  around it. */
export function generatePalettesAroundAccent(
  accentHex: string,
  count = 6,
): Palette[] {
  const accentLch = oklch(accentHex);
  if (!accentLch) return [];
  const hue = (accentLch as Oklch).h ?? 0;
  // Treat as "vibrant" base, vary lightness slightly per output.
  const recipe = RECIPES.vibrant;
  const out: Palette[] = [];
  for (let i = 0; i < count; i++) {
    out.push(buildOne(hue, recipe, i, `Var ${i + 1}`));
  }
  return out;
}

/** Tiny deterministic PRNG (mulberry32) — fast, good distribution for UI use. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
