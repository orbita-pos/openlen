import { describe, expect, it } from "vitest";
import { medidasDelLienzo } from "./lienzo";

describe("el lienzo del prototipo en un teléfono de verdad", () => {
  it("390 de ancho escalado al ancho del teléfono; el alto se estira", () => {
    const m = medidasDelLienzo(412, 915);
    expect(m.escala).toBeCloseTo(412 / 390, 5);
    expect(m.alto).toBe(Math.round(915 / (412 / 390)));
  });

  it("nunca más bajo que el del prototipo (844): ahí manda el alto", () => {
    const m = medidasDelLienzo(500, 700);
    expect(m.escala).toBeCloseTo(700 / 844, 5);
    expect(m.alto).toBe(844);
  });
});
