// Contrast + builder gate for the temática kits. Same critical guarantee as
// the Looks gate: body text must be readable (fg/bg AND fg/surface ≥ AA 4.5 —
// surface matters more here because glass cards are where most copy sits).
// Accent must clear UI contrast (≥ 3.0) on the kit bg since CTAs re-tint to
// it. The builder tests lock the structural invariants: the iOS-safe fixed
// pseudo layer (never background-attachment), the carrier transparency rules
// out-ranking canonize-at-runtime, gradient-text guards, and URL escaping.
import { describe, it, expect } from "vitest";
import { wcagContrast } from "culori";
import {
  TEMATICA_PRESETS,
  tematicaCss,
  readTematicaId,
  readTematicaBackdrop,
  resolveBackdrop,
  getTematica,
} from "./presets";

describe("temática kits — token contrast", () => {
  for (const k of TEMATICA_PRESETS) {
    const bg = k.tokens["--ol-bg"];
    const surface = k.tokens["--ol-surface"];
    const fg = k.tokens["--ol-fg"];
    const accent = k.tokens["--ol-accent"];

    it(`${k.id} — fg/bg ≥ AA`, () => {
      expect(wcagContrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${k.id} — fg/surface ≥ AA (glass cards carry the copy)`, () => {
      expect(wcagContrast(fg, surface)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${k.id} — accent/bg ≥ 3.0 (UI large)`, () => {
      expect(wcagContrast(accent, bg)).toBeGreaterThanOrEqual(3.0);
    });
    it(`${k.id} — complete kit shape with variant backdrops`, () => {
      expect(k.backdrops.length).toBeGreaterThanOrEqual(1);
      for (const b of k.backdrops) {
        expect(b.id).toBeTruthy();
        expect(b.desktop).toMatch(/^https:\/\//);
        expect(b.thumb).toMatch(/^https:\/\//);
        if (b.mobile) expect(b.mobile).toMatch(/^https:\/\//);
      }
      // Variant ids unique within the kit.
      expect(new Set(k.backdrops.map((b) => b.id)).size).toBe(k.backdrops.length);
      expect(k.scrim).toContain("gradient");
      expect(k.glass.surfacePct).toBeGreaterThan(30);
      expect(k.glass.surfacePct).toBeLessThanOrEqual(100);
    });
  }
});

describe("tematicaCss builder", () => {
  for (const k of TEMATICA_PRESETS) {
    const css = tematicaCss(k);

    it(`${k.id} — iOS-safe fixed backdrop layer, scoped to the kit id`, () => {
      expect(css).toContain(`html[data-ol-tematica="${k.id}"]::before`);
      expect(css).toContain("position:fixed");
      expect(css).toContain(k.backdrops[0].desktop);
      expect(css).not.toContain("background-attachment");
    });

    it(`${k.id} — variant selection swaps the backdrop url`, () => {
      for (const b of k.backdrops) {
        const variantCss = tematicaCss(k, b.id);
        expect(variantCss).toContain(b.desktop);
        if (b.mobile) expect(variantCss).toContain(b.mobile);
      }
      // Unknown variant falls back to the hero scene.
      expect(tematicaCss(k, "no-such-scene")).toContain(k.backdrops[0].desktop);
      expect(resolveBackdrop(k, undefined).id).toBe(k.backdrops[0].id);
    });

    it(`${k.id} — transparency out-ranks the canonize force rules`, () => {
      // canonize injects `html,body,[data-ol-bg-carrier]{background-color:
      // var(--ol-bg) !important}` — our rules must pair !important with the
      // kit attribute selector so they win on specificity.
      expect(css).toMatch(
        /\[data-ol-tematica="[^"]+"\] \[data-ol-bg-carrier\]\{background-color:transparent !important/,
      );
    });

    it(`${k.id} — ink override guards gradient text`, () => {
      expect(css).toContain(':not([class*="bg-clip"])');
      expect(css).toContain(':not([class*="text-transparent"])');
      expect(css).toContain("var(--ol-fg");
    });

    it(`${k.id} — glass uses the surface token + backdrop-filter`, () => {
      expect(css).toContain("backdrop-filter:blur(");
      expect(css).toContain("var(--ol-surface");
    });
  }

  it("escapes hostile backdrop URLs (no breaking out of url())", () => {
    const hostile = {
      ...TEMATICA_PRESETS[0],
      backdrops: [
        {
          id: "x",
          desktop: 'https://x.com/a.webp") } body { display:none } x("',
          thumb: "https://x.com/t.webp",
        },
      ],
    };
    const css = tematicaCss(hostile);
    expect(css).not.toContain('a.webp")');
    expect(css).toContain('a.webp\\"');
  });

  it("dark kits get light halftone ink, light kits dark ink", () => {
    const noir = getTematica("anime-noir")!;
    expect(noir.texture).toBe("halftone");
    expect(tematicaCss(noir)).toContain("rgba(255,255,255,0.10)");
  });
});

describe("readTematicaId / readTematicaBackdrop", () => {
  it("reads the stamped ids off <html>", () => {
    const doc =
      '<!doctype html><html lang="en" data-ol-tematica="coquette" data-ol-tematica-bg="petals"><body></body></html>';
    expect(readTematicaId(doc)).toBe("coquette");
    expect(readTematicaBackdrop(doc)).toBe("petals");
  });
  it("kit id never confuses the -bg attribute (and vice versa)", () => {
    const doc =
      '<!doctype html><html data-ol-tematica-bg="moon" data-ol-tematica="anime-dream"><body></body></html>';
    expect(readTematicaId(doc)).toBe("anime-dream");
    expect(readTematicaBackdrop(doc)).toBe("moon");
  });
  it("returns empty when absent", () => {
    expect(readTematicaId("<!doctype html><html><body></body></html>")).toBe("");
    expect(readTematicaBackdrop("<!doctype html><html><body></body></html>")).toBe("");
  });
});
