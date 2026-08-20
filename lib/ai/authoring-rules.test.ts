import { describe, expect, it } from "vitest";

import { LANGUAGE_RULE } from "./authoring-rules";

describe("la regla de idioma", () => {
  it("ata el idioma al brief, sin fijar ninguno", () => {
    expect(LANGUAGE_RULE).toMatch(/mismo idioma que el BRIEF/i);
    // Fijar "español" rompería el brief en árabe, que en la misma medición
    // salió correcto con lang="ar" dir="rtl".
    expect(LANGUAGE_RULE).not.toMatch(/\ben espa[ñn]ol\b/i);
    expect(LANGUAGE_RULE).not.toMatch(/\bin english\b/i);
  });

  it("pide marcar lang y dir — un visitante con lector de pantalla depende de eso", () => {
    expect(LANGUAGE_RULE).toContain("<html lang>");
    expect(LANGUAGE_RULE).toContain("rtl");
  });

  it("termina en línea en blanco: va pegada delante del brief", () => {
    expect(LANGUAGE_RULE.endsWith("\n\n")).toBe(true);
  });
});
