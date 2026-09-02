import { describe, expect, it, vi } from "vitest";
import { createResaltarController } from "./resaltar-controller";

describe("resaltarController", () => {
  it("le pasa el índice a quien esté escuchando", () => {
    const c = createResaltarController();
    const visto: number[] = [];
    c.subscribe((i) => visto.push(i));
    c.resaltar(3);
    expect(visto).toEqual([3]);
  });

  it("una sección QUITADA (índice -1) no se manda: ya no está en la página", () => {
    const c = createResaltarController();
    const fn = vi.fn();
    c.subscribe(fn);
    c.resaltar(-1);
    c.resaltar(1.5);
    c.resaltar(Number.NaN);
    expect(fn).not.toHaveBeenCalled();
    c.resaltar(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("darse de baja funciona — el lienzo se desmonta al cambiar de vista", () => {
    const c = createResaltarController();
    const fn = vi.fn();
    const baja = c.subscribe(fn);
    baja();
    c.resaltar(2);
    expect(fn).not.toHaveBeenCalled();
  });

  it("sin nadie escuchando no pasa nada: el turno terminó igual", () => {
    expect(() => createResaltarController().resaltar(1)).not.toThrow();
  });

  it("un suscriptor que revienta no se lleva a los demás por delante", () => {
    const c = createResaltarController();
    const bueno = vi.fn();
    c.subscribe(() => {
      throw new Error("boom");
    });
    c.subscribe(bueno);
    expect(() => c.resaltar(1)).not.toThrow();
    expect(bueno).toHaveBeenCalledWith(1);
  });
});
