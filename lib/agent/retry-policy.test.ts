import { describe, expect, it } from "vitest";

import { retryAfterMs } from "@/lib/ai/provider-error-code";
import { MAX_PROVIDER_RETRIES, isRetryable, providerWait, retryDelayMs, sleepAbortable } from "./retry-policy";

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

// El `Retry-After` del proveedor (DeepSeek, `bounded-llm-request-recovery`): lo lee el adaptador, en
// segundos o como fecha HTTP; dentro del techo es la espera exacta, más allá no se reintenta antes.
describe("el Retry-After del proveedor", () => {
  const ahora = Date.parse("Sun, 25 Oct 2026 12:00:00 GMT");
  it.each([
    ["7", 7_000],
    ["0.5", 500],
    ["Sun, 25 Oct 2026 12:00:03 GMT", 3_000],
  ])("lee %s", (cabecera, ms) => {
    expect(retryAfterMs(cabecera, ahora)).toBe(ms);
  });

  it.each([[null], [""], ["0"], ["-3"], ["mañana"], ["Sun, 25 Oct 2026 11:59:00 GMT"]])("no lee %s", (cabecera) => {
    expect(retryAfterMs(cabecera, ahora)).toBeUndefined();
  });

  it("dentro del techo es la espera; más allá, no se espera; sin cabecera, nada", () => {
    expect(providerWait(7_000)).toEqual({ ms: 7_000 });
    expect(providerWait(10_000)).toEqual({ ms: 10_000 });
    expect(providerWait(30_000)).toBe("over_cap");
    expect(providerWait(undefined)).toBeNull();
  });
});
