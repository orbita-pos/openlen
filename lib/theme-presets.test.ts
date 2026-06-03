// Contrast gate for the curated Looks. The critical guarantee is BODY TEXT
// readability (fg/bg ≥ AA 4.5) in BOTH modes — light from the curated bundle,
// dark from the derived counterpart. We deliberately do NOT gate the brand
// accent's own contrast on bg: a coral/gold/green accent used for fills is an
// intentional design choice, and accent-ink (text ON the accent) is derived
// separately. This test fails the build if any curated look would ship
// unreadable copy.
import { describe, it, expect } from "vitest";
import { wcagContrast } from "culori";
import { THEME_PRESETS } from "./theme-presets";
import { lookFromAccent } from "./palette-gen";

describe("curated theme presets — text contrast", () => {
  for (const p of THEME_PRESETS) {
    const bg = p.tokens["--ol-bg"];
    const fg = p.tokens["--ol-fg"];
    const accent = p.tokens["--ol-accent"];

    it(`${p.id} — light fg/bg ≥ AA`, () => {
      expect(wcagContrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${p.id} — derived dark fg/bg ≥ AA`, () => {
      const dark = lookFromAccent(accent).dark;
      expect(
        wcagContrast(dark["--ol-fg"], dark["--ol-bg"]),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${p.id} — has a category`, () => {
      expect(p.category).toBeTruthy();
    });
  }
});
