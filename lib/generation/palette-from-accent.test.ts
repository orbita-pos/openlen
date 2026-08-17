// La dirección creativa se elegía como el más parecido entre 7 nichos fijos, así
// que una clínica dental salía con la paleta de terror ([[seven-palettes-horror-attractor]]).
// El reemplazo es: el modelo elige el gusto —modo y UN acento— y el código
// deriva las ocho entradas de la paleta.
//
// El corte está ahí por una razón: un modelo puede elegir un color bonito, pero
// no puede prometer que ocho colores contrasten entre sí. `lookFromAccent`
// garantiza AA por construcción, y después del día que llevamos persiguiendo
// texto ilegible esa garantía es justamente la que queremos debajo.
import { describe, expect, it } from "vitest";
import { paletteFromAccent } from "./palette-from-accent";
import { CreativeDirectionSchema } from "./creative-contracts";

/** WCAG relative luminance + contrast ratio, para afirmar legibilidad de verdad
 *  en vez de "se ve distinto". */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const ACCENTS = ["#B91C35", "#246B58", "#1769AA", "#C93413", "#6342D8", "#ffd23f"];

describe("paletteFromAccent", () => {
  it.each(ACCENTS)("body text clears AA on %s in every mode", (accent) => {
    for (const mode of ["light", "dark", "cream"] as const) {
      const p = paletteFromAccent(accent, mode);
      expect(contrast(p.background, p.foreground), `${accent}/${mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ACCENTS)("the accent stays legible on its own background — %s", (accent) => {
    for (const mode of ["light", "dark", "cream"] as const) {
      const p = paletteFromAccent(accent, mode);
      expect(contrast(p.background, p.accent), `${accent}/${mode}`).toBeGreaterThanOrEqual(3);
      // Ink ON the accent, which is what a button's label uses.
      expect(contrast(p.accent, p.accentInk), `ink ${accent}/${mode}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("produces a palette the direction schema accepts", () => {
    const palette = paletteFromAccent("#B91C35", "dark");

    expect(() => CreativeDirectionSchema.shape.palette.parse(palette)).not.toThrow();
  });

  it("puts dark backgrounds in dark mode and light ones in light", () => {
    const dark = paletteFromAccent("#B91C35", "dark");
    const light = paletteFromAccent("#B91C35", "light");

    expect(contrast("#ffffff", dark.background)).toBeGreaterThan(contrast("#ffffff", light.background));
  });

  it("makes cream warm, and still light — not a second name for light", () => {
    const cream = paletteFromAccent("#246B58", "cream");
    const light = paletteFromAccent("#246B58", "light");
    const red = (hex: string) => parseInt(hex.slice(1, 3), 16);
    const blue = (hex: string) => parseInt(hex.slice(5, 7), 16);

    expect(cream.background).not.toBe(light.background);
    // Warm = more red than blue. A "cream" that is bluer than its light
    // counterpart is just light with extra steps.
    expect(red(cream.background) - blue(cream.background))
      .toBeGreaterThan(red(light.background) - blue(light.background));
  });

  it("is deterministic — the same accent always gives the same palette", () => {
    expect(paletteFromAccent("#B91C35", "dark")).toEqual(paletteFromAccent("#B91C35", "dark"));
  });

  it("falls back rather than throwing on a colour it cannot parse", () => {
    // The accent comes from a model. A page is never lost over one bad hex.
    const p = paletteFromAccent("not-a-colour", "light");

    expect(contrast(p.background, p.foreground)).toBeGreaterThanOrEqual(4.5);
  });
});
