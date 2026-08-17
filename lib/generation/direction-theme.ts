import type { AssembleTheme } from "@/lib/sections/assemble";
import type { CreativeDirection } from "./creative-contracts";
import {
  CREATIVE_FONT_MOODS,
  CREATIVE_RADIUS_PX,
  CREATIVE_TEXT_SCALES,
} from "./creative-registry";

/**
 * The creative direction, as the theme `assembleDocument` stamps onto `<html>`.
 *
 * This existed only as `directionTokens` inside the creative compiler, so the
 * baseline — which is what the user actually sees when the creative session
 * changes nothing — was assembled with `COMPOSITION_BASE_THEME`: white
 * background, zinc accent, `ui-sans-serif`. Frozen, and passed unconditionally.
 *
 * The result was not subtle. A horror brief whose direction asks for `#09090B`
 * and a blood-red accent shipped `<html class="light" style="--ol-bg:#ffffff">`,
 * and since an inline custom property on the root is the most specific place a
 * `var()` can resolve from, it beat the dark CSS the model wrote on top: hero
 * black, every section below it cream-on-white. It passed sanitization,
 * sealing, geometry, overflow, the visual critic and the delivery gate, because
 * none of them asks whether the page's theme is the one it requested.
 *
 * Light-mode niches were never protected — they just happened to agree with the
 * default, which is why kids-coloring looked fine and made a misleading control.
 */
export function assembleThemeFor(
  direction: CreativeDirection,
  lang?: string,
): AssembleTheme {
  const display = CREATIVE_FONT_MOODS[direction.typography.display];
  const body = CREATIVE_FONT_MOODS[direction.typography.body];
  return {
    base: {
      bg: direction.palette.background,
      surface: direction.palette.surface,
      fg: direction.palette.foreground,
      border: direction.palette.border,
      accent: direction.palette.accent,
    },
    mode: direction.mode,
    fontDisplay: display.display,
    fontBody: body.body,
    radius: CREATIVE_RADIUS_PX[direction.geometry.radius],
    rScale: String(direction.geometry.radiusScale),
    spaceScale: String(direction.geometry.spacingScale),
    textScale: CREATIVE_TEXT_SCALES[direction.typography.scale],
    ...(lang ? { lang } : {}),
  };
}
