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
  /** The bubble's and the send button's outline: her color a step toward its ink, so a white one keeps its edge on a
   *  light panel and a black one on a dark panel. */
  edge: string;
  /** Her header's background on a light theme, and on a dark one: her color, mostly paper. */
  soft: string;
  softDark: string;
}

/** `null` when it is not a color: the chat then keeps its own. */
/** How many 5 % steps toward black her color may take to carry white text: a quarter. */
const WHITE_TEXT_MAX_STEPS = 5;

/** `color` moved away from `ink` in 5 % steps until `ink` reads on it at 4.5:1 (20 steps at most). */
function towardInk(color: string, ink: string): { tint: string; steps: number } {
  let tint = color;
  let steps = 0;
  while (contrast(tint, ink) < 4.5 && steps < 20) {
    steps++;
    tint = mix(color, ink === DARK ? "#ffffff" : "#000000", steps * 0.05);
  }
  return { tint, steps };
}

export function tintOf(color: string): Tint | null {
  if (!HEX.test(color)) return null;
  const hers = color.toLowerCase();
  // White text whenever her color takes it with a quarter of darkening at most — a mid blue, Len's orange, a pink —,
  // as the chats she is drawn from do (Jesús 16/11); a light color (a yellow, a light green) keeps dark text.
  const darkened = towardInk(hers, LIGHT);
  const ink = darkened.steps <= WHITE_TEXT_MAX_STEPS || contrast(hers, LIGHT) > contrast(hers, DARK) ? LIGHT : DARK;
  // The color moves away from its ink, only as far as it has to, so the text reads at 4.5:1.
  const tint = ink === LIGHT ? darkened.tint : towardInk(hers, DARK).tint;
  let edge = tint;
  for (let step = 1; contrast(tint, edge) < 1.3 && step <= 20; step++) edge = mix(tint, ink, step * 0.04);
  return { tint, ink, edge, soft: mix(hers, "#ffffff", 0.86), softDark: mix(hers, "#000000", 0.78) };
}

/** The CSS variables her place sets on its root (app/[locale]/new/tokens.css reads them under `.assistant-tint`). */
export function tintStyle(color: string): Record<string, string> {
  const t = tintOf(color);
  return t ? { "--assistant-tint": t.tint, "--assistant-ink": t.ink, "--assistant-edge": t.edge, "--assistant-soft": t.soft, "--assistant-soft-dark": t.softDark } : {};
}
