// THE ASSISTANT'S LOOK AS DATA (spec local 2026-11-10-figuras-del-asistente, §5.1): a figure is a small checked
// object, never an image. Both drawings come from it — the flat SVG (./flat.ts) and the live furry one (./engine/).
// The catalog lives HERE and nowhere else: adding a shape or an accessory is adding an entry, and nothing may depend
// on how many there are. The catalog is ours; it holds none of another product's characters.
//
// Pure and client-safe: no Node, no React.

export const FIGURE_SHAPES = ["drop", "round", "capsule", "cube", "ears", "heart", "flower", "triangle"] as const;
export const FIGURE_EYES = ["oval", "round", "dot", "smile", "sleepy"] as const;
export const FIGURE_EYEWEAR = ["none", "round", "shades"] as const;
export const FIGURE_ACCESSORIES = ["none", "beret", "beanie", "bow", "crown", "hat", "headphones"] as const;

export type FigureShape = (typeof FIGURE_SHAPES)[number];
export type FigureEyes = (typeof FIGURE_EYES)[number];
export type FigureEyewear = (typeof FIGURE_EYEWEAR)[number];
export type FigureAccessory = (typeof FIGURE_ACCESSORIES)[number];
export type FigureCategory = "shape" | "eyes" | "eyewear" | "accessory";

export interface FigureLook {
  v: 1;
  shape: FigureShape;
  /** Free: any #rrggbb, lower case. */
  color: string;
  eyes: FigureEyes;
  eyewear: FigureEyewear;
  accessory: FigureAccessory;
  accessoryColor?: string;
}

/** The suggested palette. The color itself is free. */
export const FIGURE_COLORS: readonly string[] = ["#ff5fa8", "#7ed321", "#ffc21a", "#2f8bff", "#ff7a45", "#9b6cff", "#19c3b1", "#ff4d5e"];

export const DEFAULT_LOOK: FigureLook = { v: 1, shape: "drop", color: FIGURE_COLORS[0]!, eyes: "oval", eyewear: "none", accessory: "none" };

/** Ids no longer offered but still drawn: retiring an entry must never break the figure someone already has. */
export const FIGURE_RETIRED: Readonly<Record<FigureCategory, readonly string[]>> = { shape: [], eyes: [], eyewear: [], accessory: [] };

const CATALOG: Readonly<Record<FigureCategory, readonly string[]>> = {
  shape: FIGURE_SHAPES,
  eyes: FIGURE_EYES,
  eyewear: FIGURE_EYEWEAR,
  accessory: FIGURE_ACCESSORIES,
};

/** What the creator offers: the catalog without what was retired. */
export function offered(category: FigureCategory): readonly string[] {
  const retired = FIGURE_RETIRED[category];
  return retired.length === 0 ? CATALOG[category] : CATALOG[category].filter((id) => !retired.includes(id));
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const CATEGORIES: readonly FigureCategory[] = ["shape", "eyes", "eyewear", "accessory"];

export function checkLook(raw: unknown): { ok: true; value: FigureLook } | { ok: false; field: "v" | FigureCategory | "color" | "accessoryColor" } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, field: "v" };
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return { ok: false, field: "v" };
  for (const c of CATEGORIES) {
    const id = o[c];
    if (typeof id !== "string" || !(CATALOG[c].includes(id) || FIGURE_RETIRED[c].includes(id))) return { ok: false, field: c };
  }
  if (typeof o.color !== "string" || !COLOR.test(o.color)) return { ok: false, field: "color" };
  if (o.accessoryColor !== undefined && (typeof o.accessoryColor !== "string" || !COLOR.test(o.accessoryColor))) return { ok: false, field: "accessoryColor" };
  const value: FigureLook = {
    v: 1,
    shape: o.shape as FigureShape,
    color: o.color.toLowerCase(),
    eyes: o.eyes as FigureEyes,
    eyewear: o.eyewear as FigureEyewear,
    accessory: o.accessory as FigureAccessory,
  };
  if (typeof o.accessoryColor === "string") value.accessoryColor = o.accessoryColor.toLowerCase();
  return { ok: true, value };
}

/** Never throws: whatever does not check whole is drawn as DEFAULT_LOOK. For the engine and the flat drawing. */
export function lookOrDefault(raw: unknown): FigureLook {
  const r = checkLook(raw);
  return r.ok ? r.value : DEFAULT_LOOK;
}

/** #rrggbb → 0..1 per channel. `color` must already be checked. */
export function rgb(color: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG relative luminance of a checked #rrggbb. */
function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DARK_INK = "#1d1d1f";
const LIGHT_INK = "#f4f4f5";

/** The eyes' ink on that body: whichever of the two contrasts more with it (WCAG contrast ratio). */
export function eyeInk(color: string): "#1d1d1f" | "#f4f4f5" {
  const body = luminance(color) + 0.05;
  return (luminance(LIGHT_INK) + 0.05) / body > body / (luminance(DARK_INK) + 0.05) ? LIGHT_INK : DARK_INK;
}

/** Two checked colors mixed, `amount` of the second: 0..1. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a), y = rgb(b);
  return "#" + x.map((c, i) => Math.round((c + (y[i]! - c) * amount) * 255).toString(16).padStart(2, "0")).join("");
}
