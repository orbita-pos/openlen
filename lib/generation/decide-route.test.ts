import { describe, expect, it } from "vitest";

import type { ScoredTemplate } from "./score-template";
import {
  DECISION_POLICY_VERSION,
  DEFAULT_THRESHOLDS,
  decideGenerationRoute,
} from "./decide-route";

function candidate(id: string, patch: Partial<ScoredTemplate> = {}): ScoredTemplate {
  return {
    id,
    eligible: true,
    structuralFit: 0.8,
    identityFit: 0.85,
    adaptationCost: 0.25,
    themeability: "high",
    reasonCodes: [],
    ...patch,
  };
}

describe("decideGenerationRoute", () => {
  it("exposes a versioned policy and explicit default thresholds", () => {
    expect(DECISION_POLICY_VERSION).toBe("template-policy/1.0");
    expect(DEFAULT_THRESHOLDS).toEqual({
      fullStructural: 0.75,
      fullIdentity: 0.8,
      skeletonStructural: 0.75,
      skeletonMaxAdaptationCost: 0.6,
    });
  });

  it("rejects non-finite or out-of-range policy thresholds", () => {
    expect(() => decideGenerationRoute([], {
      ...DEFAULT_THRESHOLDS,
      fullIdentity: Number.NaN,
    })).toThrow("Decision thresholds must be finite values between 0 and 1.");
    expect(() => decideGenerationRoute([], {
      ...DEFAULT_THRESHOLDS,
      skeletonMaxAdaptationCost: 1.1,
    })).toThrow("Decision thresholds must be finite values between 0 and 1.");
  });

  it("chooses a whole template only at or above both thresholds", () => {
    expect(decideGenerationRoute([
      candidate("good", { structuralFit: 0.75, identityFit: 0.8 }),
    ])).toMatchObject({ route: "template_full", templateId: "good" });

    expect(decideGenerationRoute([
      candidate("low-identity", { structuralFit: 0.9, identityFit: 0.79 }),
    ]).route).not.toBe("template_full");
  });

  it("never chooses high structure and low identity as a whole template", () => {
    expect(decideGenerationRoute([
      candidate("skeleton", {
        structuralFit: 0.9,
        identityFit: 0.4,
        adaptationCost: 0.55,
      }),
    ])).toMatchObject({ route: "template_skeleton", templateId: "skeleton" });
  });

  it("requires high themeability and bounded adaptation cost for a skeleton", () => {
    const mediumTheme = candidate("medium-theme", {
      structuralFit: 0.9,
      identityFit: 0.4,
      adaptationCost: 0.55,
      themeability: "medium",
    });
    const expensive = candidate("expensive", {
      structuralFit: 0.9,
      identityFit: 0.4,
      adaptationCost: 0.61,
    });

    expect(decideGenerationRoute([mediumTheme]).route).toBe("section_composition");
    expect(decideGenerationRoute([expensive]).route).toBe("section_composition");
    expect(decideGenerationRoute([mediumTheme]).rejectedCandidates[0]?.reasonCodes)
      .toContain("themeability_below_threshold");
  });

  it("returns section composition when no template is suitable", () => {
    expect(decideGenerationRoute([
      candidate("bad", { structuralFit: 0.4, identityFit: 0.3, adaptationCost: 0.8 }),
    ])).toMatchObject({
      route: "section_composition",
      templateId: null,
      structuralFit: 0.4,
      identityFit: 0.3,
      adaptationCost: 0.8,
    });
  });

  it("returns a safe empty section-composition decision for no candidates", () => {
    expect(decideGenerationRoute([])).toEqual({
      schemaVersion: "generation-decision/1.0",
      route: "section_composition",
      templateId: null,
      structuralFit: 0,
      identityFit: 0,
      adaptationCost: 1,
      selectedSections: [],
      rejectedCandidates: [],
    });
  });

  it("keeps the best candidate deterministic under input order and locale", () => {
    const lowercase = candidate("a");
    const uppercase = candidate("Z");
    const first = [lowercase, uppercase];
    const second = [uppercase, lowercase];

    expect(decideGenerationRoute(first).templateId).toBe("Z");
    expect(decideGenerationRoute(second).templateId).toBe("Z");
    expect(first.map((item) => item.id)).toEqual(["a", "Z"]);
  });

  it("retains hard-filter and threshold reasons without duplicates", () => {
    const rejected = candidate("academy", {
      eligible: false,
      structuralFit: 0.4,
      identityFit: 0.3,
      adaptationCost: 0.8,
      reasonCodes: ["forbidden_visual_signal", "identity_below_threshold"],
    });

    expect(decideGenerationRoute([rejected]).rejectedCandidates).toEqual([{
      id: "academy",
      reasonCodes: [
        "forbidden_visual_signal",
        "identity_below_threshold",
        "structure_below_threshold",
        "adaptation_cost_too_high",
      ],
    }]);
  });

  it("never selects an ineligible candidate even with perfect scores", () => {
    const filtered = candidate("filtered", {
      eligible: false,
      structuralFit: 1,
      identityFit: 1,
      adaptationCost: 0,
      reasonCodes: ["domain_incompatible"],
    });

    expect(decideGenerationRoute([filtered])).toMatchObject({
      route: "section_composition",
      templateId: null,
    });
  });

  it.each([
    candidate("", {}),
    candidate("nan", { identityFit: Number.NaN }),
    candidate("overflow", { adaptationCost: 1.1 }),
    candidate("inconsistent", { eligible: false, reasonCodes: [] }),
  ])("rejects malformed scored candidates before sorting", (malformed) => {
    expect(() => decideGenerationRoute([malformed]))
      .toThrow("Scored candidates must satisfy the runtime scoring contract.");
  });

  it("rejects duplicate candidate ids instead of hiding audit rows", () => {
    expect(() => decideGenerationRoute([candidate("same"), candidate("same")]))
      .toThrow("Scored candidate ids must be unique.");
  });
});
