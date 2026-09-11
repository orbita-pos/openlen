import { describe, expect, it, vi } from "vitest";

import { conPlazo } from "./con-plazo";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("conPlazo", () => {
  it("devuelve el valor de un trabajo rápido", async () => {
    await expect(conPlazo(() => Promise.resolve("rápido"), 50, "fallback")).resolves.toBe("rápido");
  });

  it("un trabajo lento cae al valor por defecto", async () => {
    await expect(
      conPlazo(() => esperar(200).then(() => "tarde"), 10, "fallback"),
    ).resolves.toBe("fallback");
  });

  it("un trabajo que revienta (promesa rechazada) cae al valor por defecto, no propaga el error", async () => {
    await expect(
      conPlazo(() => Promise.reject(new Error("columna inexistente")), 50, "fallback"),
    ).resolves.toBe("fallback");
  });

  // Fix round 2 — Finding 2. Con la forma anterior (`trabajo: Promise<T>`), el
  // llamador evaluaba la promesa ANTES de entrar en `conPlazo`: un productor
  // SÍNCRONO que revienta al construirla se escapaba por delante del `try`.
  // Esta prueba falla contra esa forma y pasa contra el pensón (`() => …`),
  // que llama a `trabajo()` DENTRO del `try`.
  it("un productor que revienta SÍNCRONAMENTE (antes de devolver una promesa) también cae al valor por defecto", async () => {
    const revienta = (): Promise<string> => {
      throw new Error("revienta antes de existir la promesa");
    };
    await expect(conPlazo(revienta, 50, "fallback")).resolves.toBe("fallback");
  });

  it("el temporizador no sobrevive a la llamada", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "clearTimeout");
      await conPlazo(() => Promise.resolve("ok"), 1_000, "fallback");
      expect(spy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
