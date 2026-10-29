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

// LEN 3.1 · lo que vio el modelo no espera la ventana: Claude Code vacía su cola
// de transcripción cada 100 ms, y entera al apagarse.
describe("lo que vio el modelo, en cuanto cambia", () => {
  it("soon escribe ya, sin esperar los 2 s", async () => {
    const escribir = vi.fn(async () => {});
    const avance = crearAvance(escribir, 2000);
    avance.soon();
    await vi.advanceTimersByTimeAsync(0);
    expect(escribir).toHaveBeenCalledTimes(1);
  });

  it("un tocar de antes no aplaza un soon, y un soon no se aplaza por un tocar de después", async () => {
    const escribir = vi.fn(async () => {});
    const avance = crearAvance(escribir, 2000);
    avance.tocar();
    avance.soon();
    avance.tocar();
    await vi.advanceTimersByTimeAsync(0);
    expect(escribir).toHaveBeenCalledTimes(1);
    // Y lo de la ventana ya salió con ella: nada más a los 2 s.
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(1);
  });

  it("🔴 un soon con una escritura en vuelo sale en cuanto aterriza, nunca encima", async () => {
    let soltar!: () => void;
    const escribir = vi.fn(() => new Promise<void>((r) => (soltar = r)));
    const avance = crearAvance(escribir, 2000);
    avance.soon();
    await vi.advanceTimersByTimeAsync(0);
    avance.soon();
    await vi.advanceTimersByTimeAsync(0);
    expect(escribir).toHaveBeenCalledTimes(1);
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(escribir).toHaveBeenCalledTimes(2);
  });

  it("🔴 flush espera a la que vuela y escribe lo último ya, sin esperar la ventana", async () => {
    let soltar!: () => void;
    const orden: string[] = [];
    const escribir = vi.fn(
      () =>
        new Promise<void>((r) => {
          orden.push("empieza");
          soltar = () => {
            orden.push("aterriza");
            r();
          };
        }),
    );
    const avance = crearAvance(escribir, 2000);
    avance.soon();
    await vi.advanceTimersByTimeAsync(0);
    avance.tocar();
    let vaciado = false;
    const vaciando = avance.flush().then(() => (vaciado = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(escribir).toHaveBeenCalledTimes(1);
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(escribir).toHaveBeenCalledTimes(2);
    expect(vaciado).toBe(false);
    soltar();
    await vaciando;
    expect(orden).toEqual(["empieza", "aterriza", "empieza", "aterriza"]);
    // Lo que tocar programó ya salió en el flush.
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).toHaveBeenCalledTimes(2);
  });

  it("tras parar, ni soon ni flush escriben", async () => {
    const escribir = vi.fn(async () => {});
    const avance = crearAvance(escribir, 2000);
    await avance.parar();
    avance.soon();
    await avance.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(escribir).not.toHaveBeenCalled();
  });
});
