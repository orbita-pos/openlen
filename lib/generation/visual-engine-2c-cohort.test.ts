import { describe, expect, it } from "vitest";
import { VISUAL_ENGINE_2C_CASES } from "./visual-engine-2c-cohort";

describe("VISUAL_ENGINE_2C_CASES", () => {
  it("freezes exactly 15 balanced synthetic cases", () => {
    expect(VISUAL_ENGINE_2C_CASES).toHaveLength(15);
    expect(new Set(VISUAL_ENGINE_2C_CASES.map((row) => row.id)).size).toBe(15);
    expect(VISUAL_ENGINE_2C_CASES.filter((row) => row.class === "healthy_keep")).toHaveLength(6);
    expect(VISUAL_ENGINE_2C_CASES.filter((row) => row.class === "repairable")).toHaveLength(6);
    expect(VISUAL_ENGINE_2C_CASES.filter((row) => row.class === "nonrepairable_or_fallback")).toHaveLength(3);
    expect(VISUAL_ENGINE_2C_CASES.filter((row) => row.route === "template_skeleton")).toHaveLength(8);
    expect(VISUAL_ENGINE_2C_CASES.filter((row) => row.route === "section_composition")).toHaveLength(7);
  });

  it("contains no private or binary material and enforces per-class call ceilings", () => {
    const serialized = JSON.stringify(VISUAL_ENGINE_2C_CASES);
    expect(serialized).not.toMatch(/dataBase64|<html|https?:\/\/|[A-Z]:\\|@[a-z0-9.-]+\.[a-z]{2,}/i);
    for (const row of VISUAL_ENGINE_2C_CASES) {
      expect(row.expectedCallCeiling).toBe(row.class === "healthy_keep" ? 1 : row.class === "repairable" ? 3 : 1);
      expect(row.expectedDelivery).toBe(row.class === "repairable" ? "repaired" : "original");
    }
  });
});
