// HER COLOR TINTS HER CHAT (spec local 2026-11-10-figuras-del-asistente, §2.4): her owner's bubbles, the send button
// and her header's background take her color; links, focus and every other button keep the workspace's. Her color is
// free, so the ink over it is computed, never assumed.
//
// Pure.
import { mix } from "@/lib/figure/look";

const DARK = "#1d1d1f";
const LIGHT = "#f4f4f5";
const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two #rrggbb. */
export function contrast(a: string, b: string): number {
  const x = luminance(a) + 0.05, y = luminance(b) + 0.05;
  return x > y ? x / y : y / x;
}

export interface Tint {
  /** Her color — nudged when it is a middle tone — as the bubbles' and the send button's background. */
  tint: string;
  /** The text over it: whichever of the two inks reads better. */
  ink: typeof DARK | typeof LIGHT;
  /** Her header's background on a light theme, and on a dark one: her color, mostly paper. */
  soft: string;
  softDark: string;
}

/** `null` when it is not a color: the chat then keeps its own. */
export function tintOf(color: string): Tint | null {
  if (!HEX.test(color)) return null;
  const hers = color.toLowerCase();
  const ink = contrast(hers, DARK) >= contrast(hers, LIGHT) ? DARK : LIGHT;
  // A middle tone (a gray, a mid blue) reads with neither ink: it moves away from its ink, only as far as it has to.
  let tint = hers;
  for (let step = 1; contrast(tint, ink) < 4.5 && step <= 20; step++) tint = mix(hers, ink === DARK ? "#ffffff" : "#000000", step * 0.05);
  return { tint, ink, soft: mix(hers, "#ffffff", 0.86), softDark: mix(hers, "#000000", 0.78) };
}

/** The CSS variables her place sets on its root (app/[locale]/new/tokens.css reads them under `.assistant-tint`). */
export function tintStyle(color: string): Record<string, string> {
  const t = tintOf(color);
  return t ? { "--assistant-tint": t.tint, "--assistant-ink": t.ink, "--assistant-soft": t.soft, "--assistant-soft-dark": t.softDark } : {};
}
