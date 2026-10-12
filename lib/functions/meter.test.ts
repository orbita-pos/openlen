// @vitest-environment node
import { describe, expect, it } from "vitest";

import { capsFromEnv, costNanoUsd, monthKey, worstCaseNanoUsd } from "./meter";

describe("meter", () => {
  it("una llamada = 200 n$ + GB‑s a 13.334 n$, redondeado hacia arriba", () => {
    expect(costNanoUsd(0)).toBe(200);
    expect(costNanoUsd(500)).toBe(200 + Math.ceil(0.5 * 0.25 * 13_334));
    expect(worstCaseNanoUsd(150)).toBe(200 + Math.ceil(150 * 0.25 * 13_334));
  });

  it("el mes en UTC", () => {
    expect(monthKey(new Date("2026-10-31T23:30:00-06:00"))).toBe("2026-11");
  });

  it("los topes: 0,25 y 0,75 por defecto; vacío no es cero; un número vale", () => {
    expect(capsFromEnv({})).toEqual({ free: 250_000_000, paid: 750_000_000 });
    expect(capsFromEnv({ OPENLEN_FUNCTIONS_CAP_FREE_USD: "", OPENLEN_FUNCTIONS_CAP_PAID_USD: " " })).toEqual({ free: 250_000_000, paid: 750_000_000 });
    expect(capsFromEnv({ OPENLEN_FUNCTIONS_CAP_FREE_USD: "0.0001", OPENLEN_FUNCTIONS_CAP_PAID_USD: "5" })).toEqual({ free: 100_000, paid: 5_000_000_000 });
    expect(capsFromEnv({ OPENLEN_FUNCTIONS_CAP_FREE_USD: "abc" }).free).toBe(250_000_000);
  });
});
