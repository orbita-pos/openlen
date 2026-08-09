import { describe, expect, it } from "vitest";

import {
  VISUAL_REPAIR_ISSUE_CODES,
  VisualQualityVerdictSchema,
} from "./visual-repair-contracts";

const CLEAN = {
  schemaVersion: "visual-quality-verdict/2.0",
  decision: "keep",
  scores: {
    themeRecognition: 9,
    visualHierarchy: 8,
    componentCoherence: 8,
    mobileReadability: 9,
    imageryRelevance: 8,
    briefAdherence: 9,
  },
  issues: [],
} as const;

describe("VisualQualityVerdictSchema", () => {
  it("accepts a clean strict v2 verdict", () => {
    expect(VisualQualityVerdictSchema.parse(CLEAN)).toEqual(CLEAN);
  });

  it("rejects unknown verdict and score keys", () => {
    expect(() => VisualQualityVerdictSchema.parse({ ...CLEAN, extra: true })).toThrow();
    expect(() => VisualQualityVerdictSchema.parse({
      ...CLEAN,
      scores: { ...CLEAN.scores, arbitraryScore: 7 },
    })).toThrow();
  });

  it.each(VISUAL_REPAIR_ISSUE_CODES)("accepts the approved issue code %s", (code) => {
    expect(VisualQualityVerdictSchema.parse({
      ...CLEAN,
      decision: "repair",
      issues: [{ code, severity: "warning", hookId: "hero:title", explanation: "Refine the visual treatment." }],
    }).issues[0]?.code).toBe(code);
  });

  it("rejects unknown issue codes, unsafe explanations, and invalid hook ids", () => {
    const baseIssue = { severity: "warning", hookId: null, explanation: "Refine the visual treatment." };
    expect(() => VisualQualityVerdictSchema.parse({
      ...CLEAN,
      decision: "repair",
      issues: [{ ...baseIssue, code: "arbitrary_css" }],
    })).toThrow();
    for (const explanation of ["<b>bad</b>", "https://example.com", "background:red;"]) {
      expect(() => VisualQualityVerdictSchema.parse({
        ...CLEAN,
        decision: "repair",
        issues: [{ ...baseIssue, code: "palette_mismatch", explanation }],
      })).toThrow();
    }
    expect(() => VisualQualityVerdictSchema.parse({
      ...CLEAN,
      decision: "repair",
      issues: [{ ...baseIssue, code: "palette_mismatch", hookId: "hero > *" }],
    })).toThrow();
  });

  it("enforces integer score bounds from 1 through 10", () => {
    for (const score of [0, 10.1, 11]) {
      expect(() => VisualQualityVerdictSchema.parse({
        ...CLEAN,
        scores: { ...CLEAN.scores, themeRecognition: score },
      })).toThrow();
    }
  });

  it("limits issues to twelve", () => {
    const issue = { code: "spacing_density", severity: "warning", hookId: null, explanation: "Reduce visual density." };
    expect(() => VisualQualityVerdictSchema.parse({
      ...CLEAN,
      decision: "repair",
      issues: Array.from({ length: 13 }, () => issue),
    })).toThrow();
  });

  it("forbids critical issues on keep and empty issues on repair", () => {
    expect(() => VisualQualityVerdictSchema.parse({
      ...CLEAN,
      issues: [{ code: "theme_mismatch", severity: "critical", hookId: null, explanation: "Theme is not recognizable." }],
    })).toThrow();
    expect(() => VisualQualityVerdictSchema.parse({ ...CLEAN, decision: "repair" })).toThrow();
  });
});
