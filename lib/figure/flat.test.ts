import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, FIGURE_ACCESSORIES, FIGURE_EYES, FIGURE_EYEWEAR, FIGURE_SHAPES, type FigureCategory } from "./look";
import { flatFigureSvg } from "./flat";

const CATALOG: Record<FigureCategory, readonly string[]> = {
  shape: FIGURE_SHAPES,
  eyes: FIGURE_EYES,
  eyewear: FIGURE_EYEWEAR,
  accessory: FIGURE_ACCESSORIES,
};

/** The markup of one named layer: <g data-part="eyes">…</g>. */
function layer(svg: string, part: string): string {
  return new RegExp(`<g data-part="${part}">(.*?)</g>`).exec(svg)?.[1] ?? "";
}

describe("flatFigureSvg", () => {
  it("is a 60×60 drawing at the asked size, hidden from assistive tech", () => {
    expect(flatFigureSvg(DEFAULT_LOOK, 32).startsWith('<svg width="32" height="32" viewBox="0 0 60 60" aria-hidden="true">')).toBe(true);
    expect(flatFigureSvg(DEFAULT_LOOK, 32).endsWith("</svg>")).toBe(true);
  });

  it("wears the body's color", () => {
    expect(flatFigureSvg({ ...DEFAULT_LOOK, color: "#12ab34" }, 30)).toContain("#12ab34");
  });

  it("draws every catalog entry differently from the others", () => {
    for (const category of Object.keys(CATALOG) as FigureCategory[]) {
      const drawings = CATALOG[category].map((id) => flatFigureSvg({ ...DEFAULT_LOOK, [category]: id }, 30));
      expect(new Set(drawings).size, category).toBe(CATALOG[category].length);
    }
  });

  it("colors the accessory, and only when there is one", () => {
    expect(layer(flatFigureSvg({ ...DEFAULT_LOOK, accessory: "beret", accessoryColor: "#0a0b0c" }, 30), "accessory")).toContain("#0a0b0c");
    expect(flatFigureSvg({ ...DEFAULT_LOOK, accessory: "none", accessoryColor: "#0a0b0c" }, 30)).not.toContain("#0a0b0c");
  });

  it("gives a black body light eyes", () => {
    expect(layer(flatFigureSvg({ ...DEFAULT_LOOK, color: "#000000" }, 30), "eyes")).toContain("#f4f4f5");
    expect(layer(flatFigureSvg(DEFAULT_LOOK, 30), "eyes")).toContain("#1d1d1f");
  });

  it("draws the default figure for anything that is not a look, without throwing", () => {
    const fallback = flatFigureSvg(DEFAULT_LOOK, 30);
    for (const raw of [undefined, {}, { shape: "sparrow" }, null, 7]) expect(flatFigureSvg(raw, 30)).toBe(fallback);
  });

  it("lets nothing be injected through the look or the size", () => {
    const svg = flatFigureSvg({ ...DEFAULT_LOOK, color: '"><script>alert(1)</script>' }, 30);
    expect(svg).toBe(flatFigureSvg(DEFAULT_LOOK, 30));
    expect(flatFigureSvg(DEFAULT_LOOK, Number.NaN)).toContain('width="32"');
    expect(flatFigureSvg(DEFAULT_LOOK, "9\"><script>" as unknown as number)).not.toContain("<script");
  });

  it("has no mouth: eyes, eyewear and accessory all sit above y = 46", () => {
    for (const shape of FIGURE_SHAPES)
      for (const eyes of FIGURE_EYES)
        for (const eyewear of FIGURE_EYEWEAR)
          for (const accessory of FIGURE_ACCESSORIES) {
            const svg = flatFigureSvg({ ...DEFAULT_LOOK, shape, eyes, eyewear, accessory }, 30);
            for (const part of ["eyes", "eyewear", "accessory"])
              for (const m of layer(svg, part).matchAll(/ (?:cy|y|y1|y2)="(-?[\d.]+)"/g)) expect(Number(m[1]), `${shape}/${eyes}/${eyewear}/${accessory} ${part}`).toBeLessThan(46);
          }
  });

  it("keeps the whole drawing inside its box", () => {
    for (const shape of FIGURE_SHAPES)
      for (const accessory of FIGURE_ACCESSORIES)
        for (const m of flatFigureSvg({ ...DEFAULT_LOOK, shape, accessory }, 30).matchAll(/ (?:cy|y|y1|y2)="(-?[\d.]+)"/g)) expect(Number(m[1]), `${shape}/${accessory}`).toBeGreaterThanOrEqual(0);
  });
});
