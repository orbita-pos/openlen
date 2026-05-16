// ─────────────────────────────────────────────────────────────────────────────
// Bridge: convert an orchestrator Palette (from lib/orchestrator/design-tokens
// .ts) into the BlockTokens shape that block components consume.
//
// Lives in lib/blocks/ rather than lib/orchestrator/ because blocks are the
// downstream consumer — the bridge belongs in their module so they stay
// independently usable (you could publish lib/blocks/ as its own npm package
// later and only need to ship this one tiny adapter).
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTES,
  RADIUS,
  SHADOWS,
  TYPOGRAPHY,
  type PaletteName,
} from "../orchestrator/design-tokens";
import type { BlockTokens } from "./types";

export function paletteToTokens(name: PaletteName): BlockTokens {
  const p = PALETTES[name];
  return {
    bg: p.bg,
    surface: p.surface,
    surfaceElevated: p.surfaceElevated,
    border: p.border,
    borderStrong: p.borderStrong,
    text: p.text,
    textMuted: p.textMuted,
    textDim: p.textDim,
    accent: p.accent,
    accentHover: p.accentHover,
    accentFg: p.accentFg,
    radius: RADIUS.default,
    shadow: name === "mono-light" ? SHADOWS.mockupLight : SHADOWS.mockupDark,
    fontDisplay: TYPOGRAPHY.fontFamily.display,
    fontBody: TYPOGRAPHY.fontFamily.sans,
    fontMono: TYPOGRAPHY.fontFamily.mono,
  };
}
