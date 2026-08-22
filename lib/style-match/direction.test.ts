import { describe, expect, it } from "vitest";

import {
  DIRECTION_BUDGET_CHARS,
  directionFromTokens,
  directionToBriefBlock,
  type StyleDirection,
} from "./direction";
import type { ExtractedTokens } from "./extract/types";

const entry = (hex: string) => ({
  hex,
  oklch: { l: 0.5, c: 0.1, h: 200 },
  weight: 1,
  occurrenceCount: 10,
});

function tokens(over: Partial<ExtractedTokens> = {}): ExtractedTokens {
  return {
    source: {
      url: "https://stripe.com/",
      hostname: "stripe.com",
      finalUrl: "https://stripe.com/",
      extractedAt: new Date().toISOString(),
    },
    color: {
      primary: entry("#635bff"),
      accents: [entry("#0000ee"), entry("#b9b9f9")],
      neutrals: [
        { step: "900", entry: entry("#0a2540") },
        { step: "100", entry: entry("#f6f9fc") },
      ],
      polarity: "light",
      raw: [],
    },
    typography: {
      family: { primary: "Inter", display: "Söhne" },
      declaredFamilies: [],
      size: { detected: [], scale: {}, ratio: null, ratioMatch: null },
    },
    spacing: {},
    radius: { personality: "rounded", scale: {}, distinctValues: [] },
    shadow: {},
    ...over,
  } as ExtractedTokens;
}

describe("la mitad MEDIDA — sin modelo, sin coste", () => {
  it("los hex son EXACTOS, no aproximados", () => {
    const d = directionFromTokens(tokens());
    const hexes = d.palette.map((p) => p.hex);
    expect(hexes).toContain("#635bff");
    expect(hexes).toContain("#0a2540");
  });

  it("prefiere la tipografía de display, que es la que da carácter", () => {
    expect(directionFromTokens(tokens()).fontFamily).toBe("Söhne");
  });

  it("y cae a la primaria cuando no hay display", () => {
    const t = tokens();
    const sinDisplay = { ...t, typography: { ...t.typography, family: { primary: "Inter" } } };
    expect(directionFromTokens(sinDisplay as ExtractedTokens).fontFamily).toBe("Inter");
  });

  it("una web sin colores detectados no revienta", () => {
    const t = tokens();
    const vacio = {
      ...t,
      color: { ...t.color, primary: undefined, accents: [], neutrals: [] },
    };
    expect(() => directionFromTokens(vacio as ExtractedTokens)).not.toThrow();
  });
});

describe("el bloque que entra en el brief", () => {
  const base = directionFromTokens(tokens());

  it("dice EXPLÍCITAMENTE que no copie", () => {
    const b = directionToBriefBlock(base);
    expect(b).toMatch(/nunca copies/i);
    expect(b).toMatch(/PROPIA/i);
  });

  // Sin esto, un modelo que lee "inspírate en stripe.com" escribe copy de
  // Stripe. El nombre del sitio NO viaja al prompt a propósito.
  it("NO menciona el dominio de la referencia", () => {
    expect(directionToBriefBlock(base)).not.toContain("stripe.com");
  });

  it("lleva los hex medidos", () => {
    expect(directionToBriefBlock(base)).toContain("#635bff");
  });

  it("respeta su techo de caracteres", () => {
    const largo: StyleDirection = { ...base, character: "x".repeat(5000) };
    expect(directionToBriefBlock(largo).length).toBeLessThanOrEqual(DIRECTION_BUDGET_CHARS);
  });

  // Al truncar se pierde el CARÁCTER (lo opinable), nunca la paleta (lo
  // medido). Por eso el orden del bloque no es cosmético.
  it("al recortar conserva la paleta y sacrifica el carácter", () => {
    const largo: StyleDirection = { ...base, character: "y".repeat(5000) };
    const b = directionToBriefBlock(largo);
    expect(b).toContain("#635bff");
  });

  it("sin carácter (visión caída) sigue siendo un bloque útil", () => {
    const b = directionToBriefBlock(base);
    expect(b).toContain("#635bff");
    expect(b).toContain("Tipografía");
  });
});
