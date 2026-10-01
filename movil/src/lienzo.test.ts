import { describe, expect, it } from "vitest";
import { medidasDelLienzo } from "./lienzo";

describe("el lienzo del prototipo en un teléfono de verdad", () => {
  it("390 de ancho escalado al ancho del teléfono; el alto se estira", () => {
    const m = medidasDelLienzo(412, 915);
    expect(m.escala).toBeCloseTo(412 / 390, 5);
    expect(m.alto).toBe(Math.round(915 / (412 / 390)));
    expect(m.izquierda).toBe(0);
  });

  it("un teléfono bajo (Galaxy A07 en Chrome: 384 × 725) llena el ancho igual, con el lienzo más bajo que 844", () => {
    const m = medidasDelLienzo(384, 725);
    expect(m.escala).toBeCloseTo(384 / 390, 5);
    expect(m.alto).toBe(Math.round(725 / (384 / 390)));
    expect(m.izquierda).toBe(0);
  });

  it("más bajo que 700 (el teléfono acostado): manda el alto y el lienzo va centrado", () => {
    const m = medidasDelLienzo(800, 400);
    expect(m.escala).toBeCloseTo(400 / 700, 5);
    expect(m.alto).toBe(700);
    expect(m.izquierda).toBe(Math.round((800 - 390 * (400 / 700)) / 2));
  });
});
