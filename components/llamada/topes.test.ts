import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearTopes } from "./topes";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("crearTopes", () => {
  it("cuelga tras el silencio, y hablar reinicia la cuenta", () => {
    const alColgar = vi.fn();
    const t = crearTopes({ silencioMs: 1000, maxMs: 10_000, alColgar });
    vi.advanceTimersByTime(900);
    t.actividad();
    vi.advanceTimersByTime(900);
    expect(alColgar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(alColgar).toHaveBeenCalledWith("silencio");
  });

  it("con Len trabajando no cuenta el silencio", () => {
    const alColgar = vi.fn();
    const t = crearTopes({ silencioMs: 1000, maxMs: 10_000, alColgar });
    t.lenTrabajando(true);
    vi.advanceTimersByTime(5000);
    expect(alColgar).not.toHaveBeenCalled();
    t.lenTrabajando(false);
    vi.advanceTimersByTime(1000);
    expect(alColgar).toHaveBeenCalledWith("silencio");
  });

  it("la duración máxima cuelga aunque haya actividad", () => {
    const alColgar = vi.fn();
    const t = crearTopes({ silencioMs: 1000, maxMs: 3000, alColgar });
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(500);
      t.actividad();
    }
    expect(alColgar).toHaveBeenCalledWith("duracion");
  });

  it("parar no deja nada programado y cuelga una sola vez", () => {
    const alColgar = vi.fn();
    const t = crearTopes({ silencioMs: 1000, maxMs: 3000, alColgar });
    t.parar();
    vi.advanceTimersByTime(10_000);
    expect(alColgar).not.toHaveBeenCalled();
  });
});
