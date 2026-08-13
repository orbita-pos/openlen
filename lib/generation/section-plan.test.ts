import { describe, expect, it } from "vitest";

import { IntentAnalysisSchema } from "./contracts";
import { planAdaptiveSectionComposition, planSectionComposition } from "./section-plan";
import type { SectionType } from "@/lib/sections/types";

const INTENT_HASH = `sha256:${"a".repeat(64)}`;
const INVENTORY_HASH = `sha256:${"b".repeat(64)}`;

const COLORING_INTENT = IntentAnalysisSchema.parse({
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: {
    siteType: "content_platform",
    requiredSections: ["hero", "coloring_gallery", "minigames", "stories", "activities"],
    primaryActions: ["color"],
    contentModel: "creative_activities",
  },
  audience: { primary: "children", ageRange: "age_4_9", secondary: ["parents"] },
  domains: ["creative_play"],
  emotionalGoals: ["playful", "magical"],
  requiredVisualSignals: ["coloring_art"],
  forbiddenVisualSignals: ["corporate_dashboard"],
  explicitConstraints: [],
  ambiguities: [],
  confidence: 0.96,
});

const ALL_NEEDED = new Set<SectionType>([
  "navbar",
  "hero",
  "gallery",
  "features",
  "footer",
]);

describe("planSectionComposition", () => {
  it("preserves every coloring role while reusing neutral component geometry", () => {
    const result = planSectionComposition({
      intent: COLORING_INTENT,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
      availableTypes: ALL_NEEDED,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.plan.rows.map(({ requestedRole, componentType }) => [requestedRole, componentType])).toEqual([
      ["header", "navbar"],
      ["hero", "hero"],
      ["coloring_gallery", "gallery"],
      ["minigames", "features"],
      ["stories", "features"],
      ["activities", "features"],
      ["footer", "footer"],
    ]);
    expect(result.plan.rows.map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(result.plan.intentHash).toBe(INTENT_HASH);
    expect(result.plan.inventoryHash).toBe(INVENTORY_HASH);
  });

  it("does not require optional page chrome when the inventory lacks it", () => {
    const result = planSectionComposition({
      intent: COLORING_INTENT,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
      availableTypes: new Set<SectionType>(["hero", "gallery", "features"]),
    });
    expect(result.ok && result.plan.rows.map((row) => row.requestedRole)).toEqual([
      "hero",
      "coloring_gallery",
      "minigames",
      "stories",
      "activities",
    ]);
  });

  it("fails before composition when a required role has no audited available component", () => {
    const intent = IntentAnalysisSchema.parse({
      ...COLORING_INTENT,
      functional: { ...COLORING_INTENT.functional, requiredSections: ["hero", "team"] },
    });
    expect(planSectionComposition({
      intent,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
      availableTypes: new Set<SectionType>(["hero"]),
    })).toEqual({ ok: false, code: "unsupported_section_role" });
  });

  it("rejects duplicate requested roles instead of collapsing them silently", () => {
    const intent = IntentAnalysisSchema.parse({
      ...COLORING_INTENT,
      functional: { ...COLORING_INTENT.functional, requiredSections: ["hero", "activities", "activities"] },
    });
    expect(planSectionComposition({
      intent,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
      availableTypes: ALL_NEEDED,
    })).toEqual({ ok: false, code: "section_role_coverage_failed" });
  });

  it("is deterministic for the same intent, hashes, and available types", () => {
    const input = {
      intent: COLORING_INTENT,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
      availableTypes: ALL_NEEDED,
    };
    expect(planSectionComposition(input)).toEqual(planSectionComposition(input));
  });

  it("plans every adaptive role even when the catalog has no compatible entry", () => {
    const result = planAdaptiveSectionComposition({
      intent: COLORING_INTENT,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
    });
    expect(result.ok && result.plan.rows.map(({ requestedRole, componentType }) => [requestedRole, componentType])).toEqual([
      ["hero", "hero"],
      ["coloring_gallery", "gallery"],
      ["minigames", "features"],
      ["stories", "features"],
      ["activities", "features"],
    ]);
  });
});
