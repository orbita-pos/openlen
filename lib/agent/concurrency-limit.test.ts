// UN TOPE DE COSAS A LA VEZ (pieza 4): la capacidad la pone quien la gasta, como
// dice DeepSeek — aquí, las visitas de `usar_pagina`, cada una con su Chromium.
import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "./concurrency-limit";

describe("createConcurrencyLimit", () => {
  it("con tope 2, la tercera espera a que acabe una", async () => {
    const limitar = createConcurrencyLimit(2);
    let enVuelo = 0;
    let max = 0;
    const tarea = (ms: number) =>
      limitar(async () => {
        enVuelo++;
        max = Math.max(max, enVuelo);
        await new Promise((r) => setTimeout(r, ms));
        enVuelo--;
        return ms;
      });
    expect(await Promise.all([tarea(20), tarea(5), tarea(5)])).toEqual([20, 5, 5]);
    expect(max).toBe(2);
  });

  it("una que falla libera su plaza y su error llega a quien la pidió", async () => {
    const limitar = createConcurrencyLimit(1);
    await expect(
      limitar(async () => {
        throw new Error("chromium no arrancó");
      }),
    ).rejects.toThrow("chromium no arrancó");
    expect(await limitar(async () => "sigue")).toBe("sigue");
  });
});
