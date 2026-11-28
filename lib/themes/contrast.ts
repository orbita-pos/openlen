// THE CONTRAST GATE'S ARITHMETIC (spec local 2026-11-27-temas-del-workspace, §4.5 and decision 3). Claude Code does not
// refuse a theme whose glass leaves the text unreadable: its app ignores the tint where it does not read. OpenLen's
// version of that is a sum with no model in it — the glass's opacity goes up, in steps, until the text over it reads
// (4.5:1, WCAG's bar for normal text), and whatever cannot be fixed that way is reported, never refused.
//
// What the glass is, to a browser: the workspace redefines `--bg`, `--bg-sidebar` and `--bg-elev` as the tint at
// `opacity`, so the text sits on «tint, laid with that alpha over the scene», an ordinary alpha blend in sRGB. The scene
// under the panel is MEASURED (`measure-under.ts`) and handed in as one colour; this file does the rest.
//
// Colours are raw ones, the forms `raw-color.ts` takes (`#hex`, `rgb()`, `hsl()` and their `a` forms): nothing else ever
// reaches a theme. Client-safe: no server imports.
import { isRawColor } from "./raw-color";
import type { ThemeToken, ThemeWindow } from "./types";

/** WCAG 2.x, normal text. */
export const READABLE = 4.5;

const GLASS_STEP = 0.02;
const GLASS_CAP = 0.95;

// ─── colours ─────────────────────────────────────────────────────────────────

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

type Rgb = readonly [number, number, number];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A raw colour as 0–255 channels (rounded, as a browser does) and an alpha from 0 to 1. Throws on anything else. */
export function parseRawColor(color: string): Rgba {
  if (!isRawColor(color)) throw new Error(`contrast: not a raw colour: ${String(color).slice(0, 40)}`);
  if (color.startsWith("#")) {
    const digits = color.slice(1);
    const expanded = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
    const byte = (i: number) => parseInt(expanded.slice(i * 2, i * 2 + 2), 16);
    return { r: byte(0), g: byte(1), b: byte(2), a: expanded.length === 8 ? byte(3) / 255 : 1 };
  }
  const inner = color.slice(color.indexOf("(") + 1, color.lastIndexOf(")")).trim();
  const tokens = inner.split(/\s*[,/]\s*|\s+/).filter(Boolean);
  const value = (t: string) => parseFloat(t);
  const percent = (t: string) => t.endsWith("%");
  const alpha = tokens[3] === undefined ? 1 : clamp(percent(tokens[3]) ? value(tokens[3]) / 100 : value(tokens[3]), 0, 1);
  if (/^rgb/i.test(color)) {
    const channel = (t: string) => Math.round(clamp(percent(t) ? (value(t) / 100) * 255 : value(t), 0, 255));
    return { r: channel(tokens[0]!), g: channel(tokens[1]!), b: channel(tokens[2]!), a: alpha };
  }
  // hsl(): hue in degrees, saturation and lightness as percentages (a bare number is read as one).
  const h = (((value(tokens[0]!) % 360) + 360) % 360) / 60;
  const s = clamp(value(tokens[1]!) / 100, 0, 1);
  const l = clamp(value(tokens[2]!) / 100, 0, 1);
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = l - chroma / 2;
  const to = (v: number) => Math.round((v + m) * 255);
  return { r: to(r1), g: to(g1), b: to(b1), a: alpha };
}

/** `top` laid over an opaque `under`, an alpha blend in sRGB: what compositing does to the pixels. */
function over(top: Rgba, under: Rgb, alpha = top.a): Rgb {
  return [top.r * alpha + under[0] * (1 - alpha), top.g * alpha + under[1] * (1 - alpha), top.b * alpha + under[2] * (1 - alpha)];
}

const WHITE: Rgb = [255, 255, 255];

/** A colour as an opaque one: a translucent colour is read over `base` (white unless the caller knows what is behind). */
function opaque(color: Rgba, base: Rgb = WHITE): Rgb {
  return color.a >= 1 ? [color.r, color.g, color.b] : over(color, base);
}

const hexOf = (rgb: Rgb) => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratioOf(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The contrast ratio of an ink on a ground, WCAG 2.x over sRGB: 1 for the same colour, 21 for black on white. A ground
 * with alpha is read over white (callers that know what is behind it flatten it first); an ink with alpha, over the
 * ground. Throws on a colour that is not a raw one.
 */
export function contrastRatio(ink: string, ground: string): number {
  const surface = opaque(parseRawColor(ground));
  return ratioOf(opaque(parseRawColor(ink), surface), surface);
}

// ─── the glass ───────────────────────────────────────────────────────────────

export interface GlassFitInput {
  /** The text colour — or every text colour the panel shows: the glass has to carry ALL of them (Claude Code's app uses a
   *  theme's tint only where its own text reads on it, and its text is more than one ink). */
  fg: string | readonly string[];
  /** The glass's tint. */
  tint: string;
  /** What the scene is, under the panel (one colour, measured). */
  under: string;
  /** What the manifest declared. */
  opacity: number;
}

/**
 * The smallest opacity that is at least the declared one, on 0.02 steps and no higher than 0.95, with which EVERY ink
 * reads on `tint` laid over `under` — and the ratio of the weakest ink there (`ink` is its index in `fg`). A glass that
 * already reads is left as it was; one is never lowered. Where no opacity reads (an ink and the tint are too alike,
 * whatever is under them) it is the one that came CLOSEST, so the caller can tell the person it still does not. A tint's
 * own alpha counts: it lets the scene through.
 */
export function glassFit(o: GlassFitInput): { opacity: number; ratio: number; ink: number } {
  const under = opaque(parseRawColor(o.under));
  const tint = parseRawColor(o.tint);
  const inks = (typeof o.fg === "string" ? [o.fg] : o.fg).map(parseRawColor);
  if (inks.length === 0) throw new Error("contrast: glassFit needs at least one ink");
  /** The weakest ink's ratio at an opacity, and which ink it is. */
  const weakestAt = (opacity: number): { ratio: number; ink: number } => {
    const surface = over(tint, under, clamp(opacity, 0, 1) * tint.a);
    let worst = { ratio: Infinity, ink: 0 };
    inks.forEach((fg, ink) => {
      const ratio = ratioOf(fg.a < 1 ? over(fg, surface) : [fg.r, fg.g, fg.b], surface);
      if (ratio < worst.ratio) worst = { ratio, ink };
    });
    return worst;
  };

  const start = clamp(o.opacity, 0, 1);
  let best = { opacity: start, ...weakestAt(start) };
  if (best.ratio >= READABLE || start >= GLASS_CAP) return best;
  for (let k = 1; ; k++) {
    const opacity = Math.min(GLASS_CAP, Math.round((start + k * GLASS_STEP) * 1e4) / 1e4);
    const at = weakestAt(opacity);
    if (at.ratio >= READABLE) return { opacity, ...at };
    if (at.ratio > best.ratio) best = { opacity, ...at };
    if (opacity >= GLASS_CAP) return best;
  }
}

/** `glassFit`'s opacity: the lowest one at or above `opacity` with which `fg` reads, or the closest there is. */
export function glassOpacityFor(o: GlassFitInput): number {
  return glassFit(o).opacity;
}

// ─── the workspace's own colours ─────────────────────────────────────────────

/**
 * The workspace's own colours for the pairs the gate reads, in each window — `app/[locale]/new/tokens.css` (the
 * `.workspace-v2` block and the `.dark .workspace-v2` one). The file writes them as `oklch()`, which a raw colour is not,
 * so they are kept here as hex: converted once from the file's own numbers with the OKLab matrices (Ottosson's) and
 * rounded to a byte. `contrast.test.ts` reads the file and converts it again on every run, and goes red when a colour
 * there moves and this does not.
 */
export const WORKSPACE_COLORS: Readonly<Record<ThemeWindow, Readonly<Record<"--bg" | "--bg-sidebar" | "--bg-elev" | GlassInk, string>>>> = {
  light: {
    "--bg": "#f8f5f5",
    "--bg-sidebar": "#f4eeef",
    "--bg-elev": "#fefcfc",
    "--fg": "#0f090a",
    "--fg-muted": "#5b5354",
    "--fg-faint": "#635b5c",
  },
  dark: {
    "--bg": "#070304",
    "--bg-sidebar": "#0b0606",
    "--bg-elev": "#0f090a",
    "--fg": "#f5f0f1",
    "--fg-muted": "#958d8d",
    "--fg-faint": "#928a8a",
  },
};

/** The workspace's text colours, every one the panels write with: `--fg-faint` too — tokens.css darkens (lightens) it to
 *  clear 4.5:1 on the page because it carries text (hints, the code lens's punctuation), not only rules. */
export const GLASS_INKS = ["--fg", "--fg-muted", "--fg-faint"] as const;
export type GlassInk = (typeof GLASS_INKS)[number];

/** The colours a glass theme's text is judged with: each of its text colours (`GLASS_INKS`, in that order) — its own, or
 *  the workspace's for its window —, and its tint or, when it names none (Claude Code's default glass has none), the
 *  workspace's own sidebar for that window. The glass is raised for the STRICTEST of them. */
export function glassInks(theme: { window: ThemeWindow; colors?: Partial<Record<ThemeToken, string>> }, glass: { tint?: string }): { fg: string[]; tint: string } {
  const own = WORKSPACE_COLORS[theme.window];
  return { fg: GLASS_INKS.map((ink) => theme.colors?.[ink] ?? own[ink]), tint: glass.tint ?? own["--bg-sidebar"] };
}

// ─── what the gate reports ───────────────────────────────────────────────────

export interface ContrastWarning {
  themeId: string;
  /** `palette_pair`: a text colour of the palette that does not read on a background. `glass_below_target`: the glass is
   *  at the most it goes and the text still does not read. `glass_unmeasured`: the scene could not be measured. */
  code: "palette_pair" | "glass_below_target" | "glass_unmeasured";
  fg?: string;
  bg?: string;
  /** Rounded to two decimals. */
  ratio?: number;
}

const PAIR_INKS = ["--fg", "--fg-muted"] as const;
const PAIR_GROUNDS = ["--bg", "--bg-sidebar", "--bg-elev"] as const;

/**
 * For a theme whose panels are not glass (a still ground, a palette alone, a scene with its glass off): every text colour
 * on every background it sets — `--fg` and `--fg-muted` on `--bg`, `--bg-sidebar` and `--bg-elev` — where either side is
 * the theme's own, the other the workspace's for its window. A pair neither side of which is the theme's is the
 * workspace's, not the theme's to answer for. A background with alpha is read over the window's page. Nothing is refused.
 */
export function paletteWarnings(theme: { id: string; window: ThemeWindow; colors?: Partial<Record<ThemeToken, string>> }): ContrastWarning[] {
  const own = WORKSPACE_COLORS[theme.window];
  const page = opaque(parseRawColor(own["--bg"]));
  const warnings: ContrastWarning[] = [];
  for (const fg of PAIR_INKS) {
    for (const bg of PAIR_GROUNDS) {
      const ink = theme.colors?.[fg];
      const ground = theme.colors?.[bg];
      if (ink === undefined && ground === undefined) continue;
      const surface = hexOf(opaque(parseRawColor(ground ?? own[bg]), page));
      const ratio = contrastRatio(ink ?? own[fg], surface);
      if (ratio < READABLE) warnings.push({ themeId: theme.id, code: "palette_pair", fg, bg, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return warnings;
}
