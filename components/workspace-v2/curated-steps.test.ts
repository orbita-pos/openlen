import { describe, it, expect } from "vitest";
import { TYPE_LADDER, nearestTypeIndex, typeStepValue, PAD_STEPS, nearestStep } from "./curated-steps";

describe("curated-steps", () => {
  it("la escalera tipográfica va de xs a 7xl y crece monotónicamente", () => {
    expect(TYPE_LADDER[0].key).toBe("xs");
    expect(TYPE_LADDER[TYPE_LADDER.length - 1].key).toBe("7xl");
    for (let i = 1; i < TYPE_LADDER.length; i++) expect(TYPE_LADDER[i].px).toBeGreaterThan(TYPE_LADDER[i - 1].px);
  });
  it("nearestTypeIndex encuentra el peldaño más cercano", () => {
    expect(TYPE_LADDER[nearestTypeIndex(16)].key).toBe("base");
    expect(TYPE_LADDER[nearestTypeIndex(34)].key).toBe("4xl");
  });
  it("typeStepValue escribe var() token + fallback literal", () => {
    expect(typeStepValue(nearestTypeIndex(16))).toEqual({
      fontSize: "var(--ol-text-base, 1rem)",
      lineHeight: "var(--ol-lh-base, 1.5rem)",
    });
  });
  it("nearestStep clasifica un padding computado en su paso", () => {
    expect(nearestStep(26, PAD_STEPS).label).toBe("M");
  });
});
