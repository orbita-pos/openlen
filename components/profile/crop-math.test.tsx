import { describe, expect, it } from "vitest";

import { clampOffset, coverScale, sourceRect } from "./crop-math";

describe("las cuentas del recorte", () => {
  it("a zoom 1 la imagen tapa el círculo por su lado corto", () => {
    expect(coverScale(400, 200, 100)).toBe(0.5);
    expect(coverScale(200, 400, 100)).toBe(0.5);
  });

  it("🔴 centrada, sale el cuadrado del medio", () => {
    expect(sourceRect(400, 200, 100, { zoom: 1, dx: 0, dy: 0 })).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(sourceRect(100, 100, 100, { zoom: 2, dx: 0, dy: 0 })).toEqual({ sx: 25, sy: 25, side: 50 });
  });

  it("🔴 no se puede sacar la imagen del círculo: el movimiento se para en el borde", () => {
    expect(clampOffset(400, 200, 100, { zoom: 1, dx: 999, dy: 999 })).toEqual({ dx: 50, dy: 0 });
    expect(clampOffset(400, 200, 100, { zoom: 1, dx: -999, dy: -5 })).toEqual({ dx: -50, dy: 0 });
    expect(sourceRect(400, 200, 100, { zoom: 1, dx: 999, dy: 0 })).toEqual({ sx: 0, sy: 0, side: 200 });
  });
});
