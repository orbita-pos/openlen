import { describe, expect, it } from "vitest";
import {
  VISUAL_ENGINE_2A_DATASET_VERSION,
  VISUAL_ENGINE_2A_PILOT_CASES,
  VisualEngine2APilotCaseSchema,
} from "./visual-engine-2a-cohort";

const EXPECTED_TABLE_MAPPINGS = [
  ["creative-club-es", "children_creative", "es", "short", "business", ["hero", "about", "services", "gallery", "contact"], "children", ["education", "creative_play"], ["rompiente"]],
  ["printable-library-en", "children_creative", "en", "medium", "educational_resource", ["hero", "about", "programs", "call_to_action", "faq", "footer"], "parents", ["education", "creative_play"], ["lantern"]],
  ["teacher-art-hub-en", "children_creative", "en", "detailed", "creator_hub", ["header", "profile_summary", "link_list", "featured_content", "social_links", "footer"], "educators", ["education", "creative_play"], ["enlace"]],
  ["taqueria-pop-es", "restaurant_hospitality", "es", "short", "restaurant", ["hero", "about", "menu", "gallery", "reservations", "contact", "footer"], "consumers", ["food_beverage", "hospitality"], ["mesa"]],
  ["bakery-morning-en", "restaurant_hospitality", "en", "medium", "business", ["hero", "about", "menu", "gallery", "testimonials", "contact", "call_to_action", "footer"], "consumers", ["food_beverage", "hospitality"], ["cafe-tramonto"]],
  ["botanical-winebar-es", "restaurant_hospitality", "es", "detailed", "restaurant_website", ["hero", "about", "menu", "events", "reservations", "contact", "footer"], "consumers", ["food_beverage", "hospitality"], ["tanino"]],
  ["breathwork-studio-en", "wellness", "en", "short", "small_business", ["hero", "about", "services", "team", "pricing", "contact"], "adults", ["wellness"], ["aire-estudio"]],
  ["sleep-community-es", "wellness", "es", "medium", "community_hub", ["hero", "about", "services", "schedule", "pricing", "testimonials", "contact"], "adults", ["wellness", "health"], ["loto"]],
  ["prenatal-movement-en", "wellness", "en", "detailed", "business", ["hero", "about", "services", "team", "pricing", "testimonials", "contact", "faq", "schedule"], "adults", ["wellness", "fitness"], ["poise"]],
  ["retro-cli-es", "technical_saas", "es", "short", "documentation_site", ["hero", "features", "how_it_works", "testimonials", "pricing", "faq", "footer"], "developers", ["developer_tools", "software_development"], ["codex"]],
  ["component-cloud-en", "technical_saas", "en", "medium", "saas_product_page", ["hero", "features", "how_it_works", "pricing", "testimonials", "faq", "call_to_action", "footer"], "developers", ["developer_tools", "saas"], ["pavilion"]],
  ["open-source-observability-es", "technical_saas", "es", "detailed", "product_landing_page", ["hero", "features", "how_it_works", "testimonials", "call_to_action", "footer"], "developers", ["developer_tools", "open_source"], ["brasa"]],
  ["color-photographer-es", "editorial_portfolio", "es", "short", "portfolio", ["hero", "gallery", "about", "testimonials", "contact"], "creative_clients", ["portfolio", "photography"], ["margot-rey"]],
  ["literary-newsletter-en", "editorial_portfolio", "en", "medium", "blog", ["header", "call_to_action", "content_list", "footer"], "readers", ["editorial", "publishing"], ["inkwell"]],
  ["friendly-design-portfolio-es", "editorial_portfolio", "es", "detailed", "portfolio", ["hero", "about", "clients", "contact"], "creative_clients", ["portfolio", "illustration"], ["marquee"]],
] as const;

describe("VISUAL_ENGINE_2A_PILOT_CASES", () => {
  it("is a strict, parseable 15-case cohort with the prescribed distribution", () => {
    expect(VisualEngine2APilotCaseSchema.array().length(15).parse(VISUAL_ENGINE_2A_PILOT_CASES)).toEqual(VISUAL_ENGINE_2A_PILOT_CASES);
    expect(VISUAL_ENGINE_2A_DATASET_VERSION).toBe("visual-engine-2a-cohort/1.0");
    expect(new Set(VISUAL_ENGINE_2A_PILOT_CASES.map((caseRow) => caseRow.id)).size).toBe(15);
    expect(Object.values(VISUAL_ENGINE_2A_PILOT_CASES.reduce<Record<string, number>>((counts, caseRow) => {
      counts[caseRow.archetype] = (counts[caseRow.archetype] ?? 0) + 1;
      return counts;
    }, {}))).toEqual([3, 3, 3, 3, 3]);
    expect(VISUAL_ENGINE_2A_PILOT_CASES.filter((caseRow) => caseRow.language === "es")).toHaveLength(8);
    expect(VISUAL_ENGINE_2A_PILOT_CASES.filter((caseRow) => caseRow.language === "en")).toHaveLength(7);
    for (const archetype of ["children_creative", "restaurant_hospitality", "wellness", "technical_saas", "editorial_portfolio"]) {
      expect(VISUAL_ENGINE_2A_PILOT_CASES.filter((caseRow) => caseRow.archetype === archetype).map((caseRow) => caseRow.briefLength).sort()).toEqual(["detailed", "medium", "short"]);
    }
  });

  it("preserves every source-table mapping and aligns its expected intent", () => {
    expect(VISUAL_ENGINE_2A_PILOT_CASES.map((caseRow) => [
      caseRow.id,
      caseRow.archetype,
      caseRow.language,
      caseRow.briefLength,
      caseRow.expectedIntent.functional.siteType,
      caseRow.expectedIntent.functional.requiredSections,
      caseRow.expectedIntent.audience.primary,
      caseRow.expectedIntent.domains,
      caseRow.allowedSkeletonTemplateIds,
    ])).toEqual(EXPECTED_TABLE_MAPPINGS);

    for (const caseRow of VISUAL_ENGINE_2A_PILOT_CASES) {
      expect(caseRow.datasetVersion).toBe(VISUAL_ENGINE_2A_DATASET_VERSION);
      expect(caseRow.allowedSkeletonTemplateIds.length).toBeGreaterThan(0);
      expect(new Set(caseRow.allowedSkeletonTemplateIds).size).toBe(caseRow.allowedSkeletonTemplateIds.length);
      expect(caseRow.expectedIntent.schemaVersion).toBe("intent-analysis/1.0");
      expect(caseRow.expectedIntent.language).toBe(caseRow.language);
      expect(caseRow.expectedIntent.requiredVisualSignals).toEqual(caseRow.requiredVisualSignals);
      expect(caseRow.expectedIntent.forbiddenVisualSignals).toEqual(caseRow.forbiddenVisualSignals);
      expect(caseRow.expectedIntent.confidence).toBe(0.95);
    }
  });

  it("deeply freezes the exported cohort", () => {
    const firstCase = VISUAL_ENGINE_2A_PILOT_CASES[0];
    const originalId = firstCase.id;
    const originalSignal = firstCase.requiredVisualSignals[0];

    expect(() => { (VISUAL_ENGINE_2A_PILOT_CASES as unknown as Array<typeof firstCase>).push(firstCase); }).toThrow();
    expect(() => { (firstCase as { id: string }).id = "mutated"; }).toThrow();
    expect(() => { (firstCase.requiredVisualSignals as unknown as string[])[0] = "mutated_signal"; }).toThrow();
    expect(VISUAL_ENGINE_2A_PILOT_CASES).toHaveLength(15);
    expect(firstCase.id).toBe(originalId);
    expect(firstCase.requiredVisualSignals[0]).toBe(originalSignal);
  });
});
