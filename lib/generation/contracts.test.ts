import { describe, expect, it } from "vitest";
import {
  GenerationDecisionSchema,
  IntentAnalysisSchema,
} from "./contracts";

const CHILDREN_INTENT = {
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: {
    siteType: "content_platform",
    requiredSections: ["coloring_gallery", "minigames", "stories"],
    primaryActions: ["start_coloring", "play", "read"],
    contentModel: "catalog",
  },
  audience: { primary: "children", ageRange: "5_10", secondary: ["parents"] },
  domains: ["children_entertainment", "creative_play"],
  emotionalGoals: ["playful", "magical", "safe"],
  requiredVisualSignals: ["coloring_page_preview", "child_friendly_illustration"],
  forbiddenVisualSignals: ["saas_dashboard", "course_progress_ui"],
  explicitConstraints: [],
  ambiguities: [],
  confidence: 0.93,
} as const;

describe("IntentAnalysisSchema", () => {
  it("accepts the approved children-coloring intent", () => {
    expect(IntentAnalysisSchema.parse(CHILDREN_INTENT)).toEqual(CHILDREN_INTENT);
  });

  it("rejects unversioned, out-of-range and prose taxonomy values", () => {
    expect(IntentAnalysisSchema.safeParse({ ...CHILDREN_INTENT, schemaVersion: "1" }).success).toBe(false);
    expect(IntentAnalysisSchema.safeParse({ ...CHILDREN_INTENT, confidence: 1.1 }).success).toBe(false);
    expect(IntentAnalysisSchema.safeParse({ ...CHILDREN_INTENT, domains: ["Children Entertainment"] }).success).toBe(false);
  });
});

describe("GenerationDecisionSchema", () => {
  it("allows explicit abstention from a whole template", () => {
    const decision = GenerationDecisionSchema.parse({
      schemaVersion: "generation-decision/1.0",
      route: "section_composition",
      templateId: null,
      structuralFit: 0.82,
      identityFit: 0.31,
      adaptationCost: 0.73,
      selectedSections: [],
      rejectedCandidates: [
        { id: "academy", reasonCodes: ["forbidden_visual_signal"] },
      ],
    });
    expect(decision.templateId).toBeNull();
  });

  it("rejects template routes without a template id", () => {
    expect(GenerationDecisionSchema.safeParse({
      schemaVersion: "generation-decision/1.0",
      route: "template_full",
      templateId: null,
      structuralFit: 0.9,
      identityFit: 0.9,
      adaptationCost: 0.1,
      selectedSections: [],
      rejectedCandidates: [],
    }).success).toBe(false);
  });
});
