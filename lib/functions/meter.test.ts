// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FUNCTION_LIMITS, FUNCTION_MEMORY_MB } from "./limits";
import { callCostNanoUsd, capsFromEnv, monthKey } from "./meter";

describe("meter", () => {
  it("una llamada = 300 n$ + 20 n$ por ms de CPU (la lista de Workers for Platforms)", () => {
    expect(callCostNanoUsd(0)).toBe(300);
    expect(callCostNanoUsd(50)).toBe(1_300);
    expect(callCostNanoUsd(200)).toBe(4_300);
  });

  it("el mes en UTC", () => {
    expect(monthKey(new Date("2026-10-31T23:30:00-06:00"))).toBe("2026-11");
  });

  it("los topes: $1 y $25 por defecto; vacío no es cero; un número vale", () => {
    expect(capsFromEnv({})).toEqual({ free: 1_000_000_000, paid: 25_000_000_000 });
    expect(capsFromEnv({ OPENLEN_FUNCTIONS_CAP_FREE_USD: "", OPENLEN_FUNCTIONS_CAP_PAID_USD: " " })).toEqual({ free: 1_000_000_000, paid: 25_000_000_000 });
    expect(capsFromEnv({ OPENLEN_FUNCTIONS_CAP_FREE_USD: "0.0001", OPENLEN_FUNCTIONS_CAP_PAID_USD: "5" })).toEqual({ free: 100_000, paid: 5_000_000_000 });
    expect(capsFromEnv({ OPENLEN_FUNCTIONS_CAP_FREE_USD: "abc" }).free).toBe(1_000_000_000);
  });
});

describe("los límites de Cloudflare", () => {
  it("128 MB; CPU 50 ms en Gratis y 200 en los de pago; peticiones a fuera 50 y 1.000; el tiempo total, el de Supabase", () => {
    expect(FUNCTION_MEMORY_MB).toBe(128);
    expect(FUNCTION_LIMITS.free).toMatchObject({ cpuMs: 50, subRequests: 50, timeoutSec: 150 });
    for (const p of ["pro", "max", "ultra"] as const) expect(FUNCTION_LIMITS[p], p).toMatchObject({ cpuMs: 200, subRequests: 1_000, timeoutSec: 400 });
  });
});
