import { describe, it, expect } from "vitest";
import { GOLDEN } from "./golden-specs";
import { parseSceneSpecStrict } from "./scene-spec";

describe("GOLDEN fixtures", () => {
  it("has at least 10 entries with unique briefs", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(10);
    expect(new Set(GOLDEN.map((g) => g.brief)).size).toBe(GOLDEN.length);
  });
  it("every spec passes strict validation", () => {
    for (const g of GOLDEN) {
      const r = parseSceneSpecStrict(g.spec);
      expect(r.ok, `${g.brief}: ${r.ok ? "" : r.errors.join(", ")}`).toBe(true);
    }
  });
  it("covers variety (>= 4 distinct geometry kinds and >= 4 materials)", () => {
    expect(new Set(GOLDEN.map((g) => g.spec.geometry.kind)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(GOLDEN.map((g) => g.spec.material.kind)).size).toBeGreaterThanOrEqual(4);
  });
});
