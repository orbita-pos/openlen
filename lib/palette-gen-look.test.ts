// Contrast gate for the Looks seed-generator. Every derived look — across a
// spread of accent seeds — must keep body text readable (fg/bg ≥ AA 4.5) in
// BOTH light and dark, and keep the accent usable on the bg. This is the
// guarantee that "pick any color → a coherent look" never ships an unreadable
// page.
import { describe, it, expect } from "vitest";
import { wcagContrast } from "culori";
import { lookFromAccent } from "./palette-gen";

const SEEDS = [
  "#2563eb", // blue
  "#ff5a36", // coral
  "#1f9d63", // green
  "#7c5cff", // violet
  "#d98a16", // gold
  "#e14d82", // pink
  "#0d8ea3", // teal
  "#475569", // slate
  "#111111", // near-black
  "#e11d48", // rose-red
  "#facc15", // bright yellow (worst case for light contrast)
  "#06b6d4", // cyan
];

describe("lookFromAccent — contrast gate", () => {
  for (const seed of SEEDS) {
    const { light, dark } = lookFromAccent(seed);

    it(`light fg/bg ≥ AA for ${seed}`, () => {
      expect(
        wcagContrast(light["--ol-fg"], light["--ol-bg"]),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`dark fg/bg ≥ AA for ${seed}`, () => {
      expect(
        wcagContrast(dark["--ol-fg"], dark["--ol-bg"]),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`accent ≥ AA-large on bg (light + dark) for ${seed}`, () => {
      expect(
        wcagContrast(light["--ol-accent"], light["--ol-bg"]),
      ).toBeGreaterThanOrEqual(3.0);
      expect(
        wcagContrast(dark["--ol-accent"], dark["--ol-bg"]),
      ).toBeGreaterThanOrEqual(3.0);
    });
  }
});
