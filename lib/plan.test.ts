import { describe, expect, it } from "vitest";

import { planFromDb } from "./plan";

describe("planFromDb", () => {
  it("🔴 lee Max: si no, un Max pagaría $20 y tendría los créditos de Gratis", () => {
    expect(planFromDb("max")).toBe("max");
  });

  it("lee Pro", () => {
    expect(planFromDb("pro")).toBe("pro");
  });

  it("todo lo demás es Gratis, nunca un plan de pago por error", () => {
    for (const raw of ["free", null, undefined, "", "PRO", "enterprise", 3]) {
      expect(planFromDb(raw)).toBe("free");
    }
  });
});
