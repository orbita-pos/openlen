import { describe, expect, it, vi } from "vitest";

import { conPlazo } from "./con-plazo";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("conPlazo", () => {
  it("devuelve el valor de un trabajo rápido", async () => {
    await expect(conPlazo(Promise.resolve("rápido"), 50, "fallback")).resolves.toBe("rápido");
  });

  it("un trabajo lento cae al valor por defecto", async () => {
    const lento = esperar(200).then(() => "tarde");
    await expect(conPlazo(lento, 10, "fallback")).resolves.toBe("fallback");
  });

  it("un trabajo que revienta cae al valor por defecto, no propaga el error", async () => {
    const revienta = Promise.reject(new Error("columna inexistente"));
    await expect(conPlazo(revienta, 50, "fallback")).resolves.toBe("fallback");
  });

  it("el temporizador no sobrevive a la llamada", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "clearTimeout");
      await conPlazo(Promise.resolve("ok"), 1_000, "fallback");
      expect(spy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
