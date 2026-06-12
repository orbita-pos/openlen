// Gates for the custom-world derivation. The contract that matters: whatever
// the user uploads — green, neon, black, gray — the derived world's ink
// clears WCAG AA on its grounds. "Fondo verde y letra verde" must be
// mathematically impossible.
import { describe, it, expect } from "vitest";
import { wcagContrast } from "culori";
import {
  deriveWorldFromPixels,
  FALLBACK_ACCENT,
} from "./derive-from-image";
import { lookFromAccent } from "../palette-gen";
import {
  buildCustomTematica,
  readTematicaBackdropUrl,
  readInlineToken,
  tematicaCss,
  CUSTOM_TEMATICA_ID,
} from "./presets";

/** Synthetic image: n pixels of one RGBA color. */
function solid(r: number, g: number, b: number, n = 256): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  return d;
}

describe("deriveWorldFromPixels", () => {
  it("bright green photo → light world with a green-family accent", () => {
    const w = deriveWorldFromPixels(solid(80, 200, 120));
    expect(w.mode).toBe("light");
    const m = /^#(..)(..)(..)$/.exec(w.accent)!;
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("dark navy photo → dark world", () => {
    expect(deriveWorldFromPixels(solid(14, 18, 40)).mode).toBe("dark");
  });

  it("grayscale photo → fallback accent (no chroma votes)", () => {
    expect(deriveWorldFromPixels(solid(128, 128, 128)).accent).toBe(FALLBACK_ACCENT);
  });

  it("black-and-orange logo → dark world with an orange accent (the brand case)", () => {
    // 70% black mark, 30% orange wordmark on transparency — black has no
    // chroma so it can't vote for the accent, but it drags luminance down.
    const n = 300;
    const d = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const orange = i % 10 < 3;
      d[i * 4] = orange ? 255 : 10;
      d[i * 4 + 1] = orange ? 122 : 10;
      d[i * 4 + 2] = orange ? 26 : 10;
      d[i * 4 + 3] = 255;
    }
    const w = deriveWorldFromPixels(d);
    expect(w.mode).toBe("dark");
    const m = /^#(..)(..)(..)$/.exec(w.accent)!;
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // And the derived dark palette reads AA — black/orange page, legible.
    const tokens = lookFromAccent(w.accent).dark;
    expect(wcagContrast(tokens["--ol-fg"], tokens["--ol-bg"])).toBeGreaterThanOrEqual(4.5);
  });

  it("transparent pixels don't vote", () => {
    const d = solid(80, 200, 120);
    for (let i = 0; i < d.length; i += 4) d[i + 3] = 0;
    // All transparent → neutral defaults, no crash.
    const w = deriveWorldFromPixels(d);
    expect(w.accent).toBe(FALLBACK_ACCENT);
  });

  it("returns the average luminance (drives the drop engine's bg plan)", () => {
    expect(deriveWorldFromPixels(solid(10, 10, 10)).lum).toBeLessThan(0.1);
    expect(deriveWorldFromPixels(solid(245, 245, 245)).lum).toBeGreaterThan(0.9);
    const mid = deriveWorldFromPixels(solid(128, 128, 128)).lum;
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe("custom world — any photo color yields readable ink (the green-on-green gate)", () => {
  // Sweep the hue wheel as if users uploaded photos of every color, both
  // bright (light world) and dim (dark world) versions.
  for (let hue = 0; hue < 360; hue += 30) {
    for (const mode of ["light", "dark"] as const) {
      it(`hue ${hue}° / ${mode} world → fg/bg + fg/surface ≥ AA`, () => {
        // hue → a saturated accent seed (what derivation would emit).
        const h = hue / 60;
        const x = 1 - Math.abs((h % 2) - 1);
        const rgb =
          h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x]
          : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
        const accent =
          "#" + rgb.map((v) => Math.round(60 + v * 160).toString(16).padStart(2, "0")).join("");
        const tokens = lookFromAccent(accent)[mode];
        const kit = buildCustomTematica("https://x.example/bg.webp", { mode, tokens });
        expect(wcagContrast(kit.tokens["--ol-fg"], kit.tokens["--ol-bg"])).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(kit.tokens["--ol-fg"], kit.tokens["--ol-surface"])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("buildCustomTematica + readers", () => {
  const tokens = lookFromAccent("#16a34a").light;
  const kit = buildCustomTematica("/api/projects/p1/assets/abc.webp", {
    mode: "light",
    tokens,
  });

  it("builds a single-backdrop kit with a ground-tinted scrim", () => {
    expect(kit.id).toBe(CUSTOM_TEMATICA_ID);
    expect(kit.backdrops).toHaveLength(1);
    expect(kit.backdrops[0].desktop).toBe("/api/projects/p1/assets/abc.webp");
    expect(kit.scrim).toMatch(/^linear-gradient\(180deg, rgba\(\d+,\d+,\d+,0\.5\)/);
    expect(kit.fontHref).toBeUndefined(); // typography stays the page's own
  });

  it("readTematicaBackdropUrl recovers the url from the dressed stylesheet", () => {
    const doc = `<!doctype html><html data-ol-tematica="custom"><head><style data-ol-tematica>${tematicaCss(kit)}</style></head><body></body></html>`;
    expect(readTematicaBackdropUrl(doc)).toBe("/api/projects/p1/assets/abc.webp");
  });

  it("readInlineToken reads tokens off the html style attribute", () => {
    const doc = `<!doctype html><html style="--ol-bg: #fff; --ol-accent: #16a34a" data-ol-tematica="custom"><body></body></html>`;
    expect(readInlineToken(doc, "--ol-accent")).toBe("#16a34a");
    expect(readInlineToken(doc, "--ol-bg")).toBe("#fff");
    expect(readInlineToken(doc, "--ol-missing")).toBe("");
  });
});
