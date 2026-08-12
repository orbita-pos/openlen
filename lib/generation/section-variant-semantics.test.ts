import { describe, expect, it } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "./ai-hybrid-niche-cohort";
import { CreativeDirectionSchema } from "./creative-contracts";
import { IntentAnalysisSchema } from "./contracts";
import {
  buildSectionSemanticPolicy,
  profileSectionVariant,
  profileDerivedSectionSemantics,
  scoreSectionSemanticProfile,
  type SectionSemanticTag,
} from "./section-variant-semantics";

describe("profileSectionVariant", () => {
  it("uses reviewed overrides for ambiguous legacy dashboard variants", () => {
    expect(profileSectionVariant({
      id: "hero-01",
      name: "Hero 01",
      variantLabel: "Default",
    })).toEqual({
      tags: ["analytics", "dashboard", "software_mockup"],
      source: "reviewed_override",
    });
    expect(profileSectionVariant({
      id: "features-01",
      name: "Features 01",
      variantLabel: "Default",
    })).toEqual({
      tags: ["analytics", "dashboard", "developer_tool"],
      source: "reviewed_override",
    });
  });

  it("derives only closed tags from ASCII-normalized catalog words", () => {
    expect(profileSectionVariant({
      id: "hero-11",
      name: "Ilustrated Creator Playground",
      variantLabel: "PLÁYFUL",
    })).toEqual({
      tags: ["creator", "illustrated", "playful"],
      source: "catalog_tokens",
    });
  });

  it("keeps unknown metadata neutral instead of guessing", () => {
    expect(profileSectionVariant({
      id: "hero-12",
      name: "Aurora",
      variantLabel: "Variant Twelve",
    })).toEqual({ tags: ["neutral"], source: "neutral" });
  });

  it("does not copy catalog text into the bounded profile", () => {
    const profile = profileSectionVariant({
      id: "hero-12",
      name: "private-customer-name",
      variantLabel: "https://private.invalid/path",
    });
    expect(JSON.stringify(profile)).not.toMatch(/customer|https|private\.invalid/);
  });
});

describe("section semantic policy", () => {
  it("uses trusted derived semantics instead of donor display text", () => {
    expect(profileDerivedSectionSemantics({
      schemaVersion: "derived-section-semantics/1.0",
      role: "hero",
      layoutArchetypes: ["editorial"],
      domains: ["children_creativity"],
      audiences: ["children"],
      moods: ["playful"],
      negativeSignals: [],
    })).toEqual({
      tags: ["creator", "editorial", "illustrated", "playful", "warm"],
      source: "derived_metadata",
    });
  });
  it.each(AI_HYBRID_NICHE_CASES)(
    "builds a deterministic bounded positive policy for $id",
    (row) => {
      const first = buildSectionSemanticPolicy(row.intent, row.expectedCreativeDirection);
      const second = buildSectionSemanticPolicy(row.intent, row.expectedCreativeDirection);
      expect(first).toEqual(second);
      expect(first.preferred.length).toBeGreaterThan(0);
      expect(new Set(first.preferred).size).toBe(first.preferred.length);
      expect(new Set(first.forbidden).size).toBe(first.forbidden.length);
    },
  );

  const forbiddenFamilies: Array<{
    signal: string;
    expected: SectionSemanticTag[];
  }> = [
    { signal: "saas_dashboard", expected: ["analytics", "corporate", "dashboard", "software_mockup"] },
    { signal: "course_progress_ui", expected: ["analytics", "course_ui", "dashboard"] },
    { signal: "adult_course_saas", expected: ["analytics", "course_ui", "dashboard"] },
    { signal: "abstract_software_mockup", expected: ["dashboard", "software_mockup"] },
    { signal: "developer_tool_ui", expected: ["developer_tool", "documentation", "terminal"] },
    { signal: "documentation_layout", expected: ["developer_tool", "documentation", "terminal"] },
    { signal: "generic_game_ui", expected: ["game_ui"] },
    { signal: "generic_ecommerce_grid", expected: ["commerce_grid"] },
    { signal: "wellness_dashboard", expected: ["analytics", "dashboard", "wellness"] },
    { signal: "corporate_photography", expected: ["corporate"] },
    { signal: "corporate_event_branding", expected: ["corporate"] },
    { signal: "conference_agenda", expected: ["corporate"] },
  ];

  it.each(forbiddenFamilies)("maps $signal to a closed hard gate", ({ signal, expected }) => {
    const base = AI_HYBRID_NICHE_CASES[0];
    const intent = IntentAnalysisSchema.parse({
      ...base.intent,
      forbiddenVisualSignals: [signal],
    });
    const direction = CreativeDirectionSchema.parse({
      ...base.expectedCreativeDirection,
      forbiddenVisualSignals: [signal],
      imagery: { ...base.expectedCreativeDirection.imagery, avoid: [signal] },
    });
    const policy = buildSectionSemanticPolicy(intent, direction);
    expect(policy.forbidden).toEqual(expected);
  });

  it("never lets positive overlap override a forbidden tag", () => {
    const coloring = AI_HYBRID_NICHE_CASES[0];
    const policy = buildSectionSemanticPolicy(
      coloring.intent,
      coloring.expectedCreativeDirection,
    );
    expect(scoreSectionSemanticProfile(
      { tags: ["playful", "illustrated", "dashboard"], source: "catalog_tokens" },
      policy,
    )).toEqual({ eligible: false, score: 0, forbiddenMatches: ["dashboard"] });
  });

  it("ranks positive overlap above a neutral profile", () => {
    const coloring = AI_HYBRID_NICHE_CASES[0];
    const policy = buildSectionSemanticPolicy(
      coloring.intent,
      coloring.expectedCreativeDirection,
    );
    expect(scoreSectionSemanticProfile(
      { tags: ["creator", "illustrated", "playful"], source: "catalog_tokens" },
      policy,
    ).score).toBeGreaterThan(scoreSectionSemanticProfile(
      { tags: ["neutral"], source: "neutral" },
      policy,
    ).score);
  });
});
