import { describe, expect, it } from "vitest";

import { MAX_PROVIDER_RETRIES, isRetryable, retryDelayMs, sleepAbortable } from "./retry-policy";

describe("la política de reintento (la de DeepSeek, literal)", () => {
  it("son cinco reintentos", () => {
    expect(MAX_PROVIDER_RETRIES).toBe(5);
  });

  it("espera 500 ms, luego el doble, hasta un techo de 10 s (azar en el centro)", () => {
    const centro = () => 0.5;
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n, centro))).toEqual([500, 1000, 2000, 4000, 8000, 10000]);
  });

  it("el azar mueve ±10 % y nunca pasa de 10 s", () => {
    expect(retryDelayMs(1, () => 0)).toBe(450);
    expect(retryDelayMs(1, () => 0.999999)).toBeCloseTo(550, 0);
    expect(retryDelayMs(6, () => 0.999999)).toBe(10000);
  });

  it("se reintentan límite, servidor, transporte y respuesta vacía", () => {
    for (const code of ["rate_limit", "server", "transport", "empty_response"] as const) expect(isRetryable(code)).toBe(true);
  });

  it("BRAZO DE CONTROL: un fallo sin código no se reintenta", () => {
    expect(isRetryable(undefined)).toBe(false);
  });

  it("la espera se corta en cuanto llega el ■", async () => {
    const ctrl = new AbortController();
    const inicio = Date.now();
    const espera = sleepAbortable(5_000, ctrl.signal);
    ctrl.abort();
    await espera;
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });
});
