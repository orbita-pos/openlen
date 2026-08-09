import { describe, expect, it } from "vitest";
import { VISUAL_ENGINE_2B_CASES } from "./visual-engine-2b-cohort";

describe("Visual Engine 2B frozen cohort", () => {
  it("contains exactly 15 distinct synthetic cases with 13 supported and 2 typed fallbacks", () => {
    expect(VISUAL_ENGINE_2B_CASES).toHaveLength(15);
    expect(new Set(VISUAL_ENGINE_2B_CASES.map((row) => row.id)).size).toBe(15);
    expect(VISUAL_ENGINE_2B_CASES.filter((row) => row.expectedFallback)).toHaveLength(2);
    expect(VISUAL_ENGINE_2B_CASES.filter((row) => row.expectedRoles)).toHaveLength(13);
  });

  it("contains no identity, key, URL, email, or absolute-path material", () => {
    const serialized = JSON.stringify(VISUAL_ENGINE_2B_CASES);
    expect(serialized).not.toMatch(/https?:|www\.|@[a-z0-9.-]+|gemini[_-]?api[_-]?key|[A-Z]:\\|\/Users\//i);
  });
});
