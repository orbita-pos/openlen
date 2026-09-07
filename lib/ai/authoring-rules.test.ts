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

  // 🔴 LA CLÁUSULA DEL RUBRO, y por qué tiene guarda propia: es lo único que
  // separa esta regla de la que ya fallaba. La versión general —«el idioma que
  // el brief»— ya estaba puesta y aun así salía UNA página en inglés por
  // corrida, tres de tres el 2026-09-07, siempre en un rubro cuyo marketing
  // suele verse en inglés: un reloj de lujo la primera vez, `documentacion` dos
  // veces, `saas` la tercera —con un brief sin una sola palabra en inglés—.
  //
  // Sin esta frase la regla vuelve a ser la que ya se midió insuficiente, y el
  // fallo volvería en silencio: `<html lang>` seguiría bien formado y ninguna
  // otra guarda mira el idioma de la copy.
  it("🔴 nombra el RUBRO — la regla general sola ya se midió insuficiente", () => {
    expect(LANGUAGE_RULE).toMatch(/rubro/i);
    // El nombre del producto es la mitad que más se escapaba: «Resolvio».
    expect(LANGUAGE_RULE).toMatch(/nombre/i);
  });
});
