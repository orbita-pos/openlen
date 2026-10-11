// @vitest-environment node
// El trozo de código de un error, como lo enseña la capa de Vite (el
// `codeFrame` de Babel): dos líneas antes, tres después, `>` en la del error y
// `^` bajo su columna.
import { describe, expect, it } from "vitest";
import { codeFrame } from "./code-frame";

const FUENTE = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho"].join("\n");

describe("codeFrame", () => {
  it("marca la línea y, debajo, la columna", () => {
    expect(codeFrame(FUENTE, 4, 3)).toBe(
      ["  2 | dos", "  3 | tres", "> 4 | cuatro", "    |   ^", "  5 | cinco", "  6 | seis", "  7 | siete"].join("\n"),
    );
  });

  it("sin columna, sin flecha; y los números se alinean al más ancho", () => {
    const larga = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n");
    expect(codeFrame(larga, 10, null)).toBe(["   8 | l8", "   9 | l9", "> 10 | l10", "  11 | l11", "  12 | l12"].join("\n"));
  });

  it("una línea que no existe no da marco", () => {
    expect(codeFrame(FUENTE, 99, 1)).toBeNull();
    expect(codeFrame(FUENTE, 0, 1)).toBeNull();
  });
});
