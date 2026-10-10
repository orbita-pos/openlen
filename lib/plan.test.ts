import { describe, expect, it } from "vitest";

import { PLAN_RANK, planFromDb } from "./plan";

describe("planFromDb", () => {
  it("🔴 lee Max: si no, un Max pagaría $20 y tendría los créditos de Gratis", () => {
    expect(planFromDb("max")).toBe("max");
  });

  it("🔴 lee Ultra: si no, un Ultra pagaría $100 y tendría los créditos de Gratis", () => {
    expect(planFromDb("ultra")).toBe("ultra");
  });

  it("el orden: Gratis < Pro < Max < Ultra", () => {
    expect(PLAN_RANK.free).toBeLessThan(PLAN_RANK.pro);
    expect(PLAN_RANK.pro).toBeLessThan(PLAN_RANK.max);
    expect(PLAN_RANK.max).toBeLessThan(PLAN_RANK.ultra);
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
