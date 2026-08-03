import { describe, expect, it } from "vitest";
import { SELECTOR_CASES } from "./selector-cases";

describe("SELECTOR_CASES", () => {
  it("contains 20 unique, bilingual safety cases", () => {
    expect(SELECTOR_CASES).toHaveLength(20);
    expect(new Set(SELECTOR_CASES.map((c) => c.id)).size).toBe(20);
    expect(new Set(SELECTOR_CASES.map((c) => c.language))).toEqual(new Set(["es", "en"]));
  });

  it("contains at least five adversarial identity cases", () => {
    expect(SELECTOR_CASES.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(5);
  });

  it("defines expected domains, audiences and forbidden signals for every case", () => {
    for (const c of SELECTOR_CASES) {
      expect(c.expectedDomains.length).toBeGreaterThan(0);
      expect(c.expectedAudience).toMatch(/^[a-z0-9_]+$/);
      expect(c.forbiddenSignals.length).toBeGreaterThan(0);
    }
  });
});
