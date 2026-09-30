import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearAvance } from "./avance-del-turno";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("guardar lo que el turno lleva, sin martillear la base", () => {
  it("cien eventos seguidos son UNA escritura, no cien", async () => {
    const escribir = vi.fn(async () => {});
    const avance = crearAvance(escribir, 2000);
    for (let i = 0; i < 100; i++) avance.tocar();
    expect(escribir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(1);
  });

  it("🔴 nunca dos a la vez, y lo que cambió mientras volaba se guarda después", async () => {
    let soltar!: () => void;
    const escribir = vi.fn(() => new Promise<void>((r) => (soltar = r)));
    const avance = crearAvance(escribir, 2000);

    avance.tocar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(1);

    // Cambia mientras la primera sigue en vuelo: no sale otra encima.
    avance.tocar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(1);

    // Al terminar la primera, lo pendiente sale en la siguiente ventana.
    soltar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(2);
  });

  it("parar corta lo programado y espera a la que vuela", async () => {
    let soltar!: () => void;
    let terminada = false;
    const escribir = vi.fn(
      () =>
        new Promise<void>((r) => {
          soltar = () => {
            terminada = true;
            r();
          };
        }),
    );
    const avance = crearAvance(escribir, 2000);
    avance.tocar();
    await vi.advanceTimersByTimeAsync(2000);

    avance.tocar();
    const parada = avance.parar();
    soltar();
    await parada;
    expect(terminada).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(escribir).toHaveBeenCalledTimes(1);
  });

  it("una escritura que falla no rompe las siguientes", async () => {
    const escribir = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("la base se fue"))
      .mockResolvedValue(undefined);
    const avance = crearAvance(escribir, 2000);
    avance.tocar();
    await vi.advanceTimersByTimeAsync(2000);
    avance.tocar();
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(2);
  });
});
