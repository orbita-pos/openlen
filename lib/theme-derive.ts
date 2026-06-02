// Derives the dependent contract color tokens from the 5 BASE roles, so the
// theme engine can drive all 13 canonical tokens (docs/openlen-contract.md)
// while the inspector exposes only the base knobs. Pure + deterministic.
//
// Why DERIVE instead of 13 independent knobs: --accent-ink, the muted/faint
// text tiers, --surface-2 and --border-strong are RELATIONSHIPS, not free
// choices. Deriving them keeps a re-theme coherent and fixes the
// hardcoded-on-accent-ink bug — changing the accent re-derives its readable ink
// automatically (the old #062614 was clavado; now it's computed).
//
// The Rust normalize chain hoists all 13 onto --ol-* with page-own defaults;
// the INSPECTOR calls this on a base-color change to keep the derived tokens
// coherent; the THEME PRESETS bake the result. Tuned to land near the canonical
// Mirror/Manuscript values (fg-muted ≈ 62% fg, fg-faint ≈ 55% but AA-floored).

import { interpolate, wcagContrast, formatHex } from "culori";

export interface BaseColors {
  bg: string;
  surface: string;
  fg: string;
  border: string;
  accent: string;
}

export interface DerivedColors {
  "surface-2": string;
  "fg-muted": string;
  "fg-faint": string;
  "border-strong": string;
  "accent-ink": string;
}

export type ContractColors = BaseColors & DerivedColors;

const AA = 4.5;

function mix(a: string, b: string, t: number): string {
  return formatHex(interpolate([a, b], "oklch")(t)) ?? a;
}

/** Text/icon color that sits ON the accent: a tasteful near-dark tinted toward
 *  the accent, or near-white — whichever reads better by WCAG contrast. */
export function deriveAccentInk(accent: string): string {
  const darkInk = mix(accent, "#000000", 0.84); // dark, faintly accent-tinted
  const lightInk = "#ffffff";
  return wcagContrast(accent, darkInk) >= wcagContrast(accent, lightInk)
    ? darkInk
    : lightInk;
}

/** Step a text tier from fg toward bg, then pull back toward fg until it clears
 *  AA contrast on that bg — so even the faint tier stays readable. */
function readableTier(fg: string, bg: string, t: number): string {
  let c = mix(fg, bg, t);
  for (let k = 0; k < 12 && wcagContrast(c, bg) < AA; k++) {
    c = mix(c, fg, 0.15);
  }
  return c;
}

/** Given the 5 base colors, return all 13 contract colors (base echoed +
 *  derived). Mode is implied by the bg/fg the caller passes (dark skins pass a
 *  dark bg + light fg, so the tiers step the right direction automatically). */
export function deriveContractColors(base: BaseColors): ContractColors {
  return {
    ...base,
    "surface-2": mix(base.surface, base.fg, 0.05),
    "fg-muted": readableTier(base.fg, base.bg, 0.34),
    "fg-faint": readableTier(base.fg, base.bg, 0.48),
    "border-strong": mix(base.border, base.fg, 0.4),
    "accent-ink": deriveAccentInk(base.accent),
  };
}
