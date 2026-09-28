import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conSenales, relojDeSilencio } from "./reloj-de-silencio";

// H1 (2026-09-25): el turno de Len ya no lleva un reloj de PARED (360 s) sino
// uno de SILENCIO: un turno largo que sigue trabajando no se corta; uno que se
// queda callado —una llamada al modelo colgada— sí.
describe("relojDeSilencio", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("un turno que da señales no se corta nunca, dure lo que dure", () => {
    const alCallar = vi.fn();
    const r = relojDeSilencio(1000, alCallar);
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(900);
      r.vivo();
    }
    expect(alCallar).not.toHaveBeenCalled();
    r.parar();
  });

  it("uno que se calla más que el margen, sí", () => {
    const alCallar = vi.fn();
    const r = relojDeSilencio(1000, alCallar);
    vi.advanceTimersByTime(500);
    r.vivo();
    vi.advanceTimersByTime(999);
    expect(alCallar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(alCallar).toHaveBeenCalledTimes(1);
  });

  it("parado, no dispara", () => {
    const alCallar = vi.fn();
    const r = relojDeSilencio(1000, alCallar);
    r.parar();
    vi.advanceTimersByTime(5000);
    expect(alCallar).not.toHaveBeenCalled();
  });

  it("cada evento del modelo cuenta como señal, y pasa tal cual", async () => {
    const vivo = vi.fn();
    const eventos = [1, 2, 3];
    const vistos: number[] = [];
    for await (const e of conSenales((async function* () { yield* eventos; })(), vivo)) vistos.push(e);
    expect(vistos).toEqual(eventos);
    expect(vivo).toHaveBeenCalledTimes(3);
  });
});
