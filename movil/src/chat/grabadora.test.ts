import { describe, expect, it } from "vitest";
import { barrasDeLaNota, conGesto, type Micro } from "./grabadora";

const quieto: Micro = { fase: "quieto" };

describe("el botón del micrófono", () => {
  it("mantener y soltar: graba y envía", () => {
    const a = conGesto(quieto, { tipo: "bajar", t: 0, x: 300 });
    expect(a.efecto).toBe("empezar");
    const b = conGesto(a.micro, { tipo: "subir", t: 1200 });
    expect(b).toMatchObject({ micro: quieto, efecto: "enviar" });
  });
  it("un toque corto la deja grabando sola, y el siguiente toque la envía", () => {
    const a = conGesto(quieto, { tipo: "bajar", t: 0, x: 300 });
    const b = conGesto(a.micro, { tipo: "subir", t: 200 });
    expect(b).toMatchObject({ micro: { fase: "grabando", fijo: true }, efecto: null });
    const c = conGesto(b.micro, { tipo: "bajar", t: 3000, x: 300 });
    expect(c.efecto).toBeNull();
    expect(conGesto(c.micro, { tipo: "subir", t: 3100 })).toMatchObject({ micro: quieto, efecto: "enviar" });
  });
  it("deslizar a la izquierda: la pista sigue al dedo (en px del lienzo) y pasados 120 cancela", () => {
    const a = conGesto(quieto, { tipo: "bajar", t: 0, x: 300 });
    expect(conGesto(a.micro, { tipo: "mover", x: 250, escala: 0.5 }).arrastre).toBe(-100);
    expect(conGesto(a.micro, { tipo: "mover", x: 400, escala: 1 }).arrastre).toBe(0);
    expect(conGesto(a.micro, { tipo: "mover", x: 170, escala: 1 })).toMatchObject({ micro: quieto, efecto: "cancelar" });
  });
  it("fija, el dedo ya no la cancela; «Cancelar» sí", () => {
    const fija: Micro = { fase: "grabando", desde: 0, x0: 300, fijo: true };
    expect(conGesto(fija, { tipo: "mover", x: 0, escala: 1 }).efecto).toBeNull();
    expect(conGesto(fija, { tipo: "cancelar" })).toMatchObject({ micro: quieto, efecto: "cancelar" });
  });
  it("quieto, sólo bajar hace algo", () => {
    expect(conGesto(quieto, { tipo: "subir", t: 5 })).toMatchObject({ micro: quieto, efecto: null });
  });
});

describe("barrasDeLaNota", () => {
  it("28 barras entre 22 y 100 de lo que midió la grabadora", () => {
    const b = barrasDeLaNota([0, 1, 0.5]);
    expect(b).toHaveLength(28);
    expect(b[0]).toBe(22);
    expect(Math.max(...b)).toBe(100);
  });
  it("sin medidas, una línea tranquila", () => {
    expect(new Set(barrasDeLaNota([], 4))).toEqual(new Set([45]));
  });
});
