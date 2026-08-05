import { describe, expect, it } from "vitest";

import { INTENT_SYSTEM_PROMPT } from "./analyze-intent";
import { SELECTOR_CASES } from "./selector-cases";
import { SELECTOR_HOLDOUT_CASES } from "./selector-holdout-cases";

describe("SELECTOR_HOLDOUT_CASES", () => {
  it("contains ten unique bilingual cases disjoint from the development corpus", () => {
    const developmentIds = new Set(SELECTOR_CASES.map((item) => item.id));

    expect(SELECTOR_HOLDOUT_CASES).toHaveLength(10);
    expect(new Set(SELECTOR_HOLDOUT_CASES.map((item) => item.id)).size).toBe(10);
    expect(SELECTOR_HOLDOUT_CASES.every((item) => !developmentIds.has(item.id))).toBe(true);
    expect(new Set(SELECTOR_HOLDOUT_CASES.map((item) => item.language)))
      .toEqual(new Set(["es", "en"]));
  });

  it("defines complete expected classifications without embedding its briefs in the prompt", () => {
    for (const item of SELECTOR_HOLDOUT_CASES) {
      expect(item.expectedDomains.length).toBeGreaterThan(0);
      expect(item.expectedAudience).toMatch(/^[a-z0-9_]+$/);
      expect(item.forbiddenSignals.length).toBeGreaterThan(0);
      expect(INTENT_SYSTEM_PROMPT).not.toContain(item.brief);
    }
  });
});
