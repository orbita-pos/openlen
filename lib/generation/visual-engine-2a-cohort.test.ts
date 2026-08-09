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
  ["open-source-observability-es", "technical_saas", "es", "detailed", "product_landing_page", ["hero", "features", "how_it_works", "testimonials", "call_to_action", "footer"], "developers", ["developer_tools", "open_source"], ["yunque"]],
  ["color-photographer-es", "editorial_portfolio", "es", "short", "portfolio", ["hero", "gallery", "about", "testimonials", "contact"], "creative_clients", ["portfolio", "photography"], ["margot-rey"]],
  ["literary-newsletter-en", "editorial_portfolio", "en", "medium", "blog", ["header", "call_to_action", "content_list", "footer"], "readers", ["editorial", "publishing"], ["inkwell"]],
  ["friendly-design-portfolio-es", "editorial_portfolio", "es", "detailed", "portfolio", ["hero", "about", "clients", "contact"], "creative_clients", ["portfolio", "illustration"], ["marquee"]],
] as const;

const EXPECTED_IDENTITY_AND_STRUCTURE = [
  ["creative-club-es", { structuralPattern: "business pattern with hero, about, services, gallery, and contact", baselineIdentity: "coastal lifestyle, active learning, and community-focused; ocean waves, surfboards, people surfing, beach scenes, and natural light", requestedIdentity: "cut-paper, crayon, joyful primary colors" }, "Retains the hero, about, services, gallery, and contact roles; the art club requires no role change."],
  ["printable-library-en", { structuralPattern: "educational resource pattern with hero, about, programs, CTA, FAQ, and footer", baselineIdentity: "storyteller, advocate, and community-builder; children, books, reading, community, growth, testimonials, and badges", requestedIdentity: "pastel sticker-book" }, "Retains the hero, about, programs, CTA, FAQ, and footer roles; themed packs and downloads require no role change."],
  ["teacher-art-hub-en", { structuralPattern: "creator hub pattern with header, profile summary, link list, featured content, social links, and footer", baselineIdentity: "minimal, clean, modern personal brand; gradient background, centered content, profile picture, short bio, event listing, and social media icons", requestedIdentity: "classroom collage without course-progress UI" }, "Retains the header, profile summary, link list, featured content, social links, and footer roles; educator resources and events require no role change."],
  ["taqueria-pop-es", { structuralPattern: "restaurant pattern with hero, about, menu, gallery, reservations, contact, and footer", baselineIdentity: "editorial, minimalist, rustic charm; food photography, restaurant interior, handcrafted elements, natural light, and warm color palette", requestedIdentity: "vivid papel-picado pop" }, "Retains the hero, about, menu, gallery, reservations, contact, and footer roles; neighborhood dining requires no role change."],
  ["bakery-morning-en", { structuralPattern: "business pattern with hero, about, menu, gallery, testimonials, contact, CTA, and footer", baselineIdentity: "minimalist, rustic chic, modern farmhouse, boutique; coffee beans, baked goods, food photography, natural light, warm lighting, and wooden elements", requestedIdentity: "bright risograph morning market" }, "Retains the hero, about, menu, gallery, testimonials, contact, CTA, and footer roles; bakery story, location, and ordering require no role change."],
  ["botanical-winebar-es", { structuralPattern: "restaurant website pattern with hero, about, menu, events, reservations, contact, and footer", baselineIdentity: "dark and moody, minimalist, editorial, boutique; wine glasses, food platters, dim lighting, elegant typography, and natural materials", requestedIdentity: "airy garden editorial, not dark nightlife" }, "Retains the hero, about, menu, events, reservations, contact, and footer roles; daytime wine-bar events and reservations require no role change."],
  ["breathwork-studio-en", { structuralPattern: "small business pattern with hero, about, services, team, pricing, and contact", baselineIdentity: "minimalist, editorial, clean, organic; soft colors, minimal typography, clean layout, natural-light feel, schedule table, pricing table, and instructor profiles", requestedIdentity: "energetic cobalt/coral geometry" }, "Retains the hero, about, services, team, pricing, and contact roles; breathwork booking requires no role change."],
  ["sleep-community-es", { structuralPattern: "community hub pattern with hero, about, services, schedule, pricing, testimonials, and contact", baselineIdentity: "minimalist, natural, clean, modern; yoga pose, pilates equipment, meditation, natural light, greenery, mountains, flowers, and tea", requestedIdentity: "dreamy midnight sky and soft constellations" }, "Retains the hero, about, services, schedule, pricing, testimonials, and contact roles; practices, calendar, and membership require no role change."],
  ["prenatal-movement-en", { structuralPattern: "business pattern with hero, about, services, team, pricing, testimonials, contact, FAQ, and schedule", baselineIdentity: "minimalist, editorial, boutique, clean, modern; pilates reformer, barre studio, fitness class schedule, instructor profiles, membership tiers, soft lighting, and blush tones", requestedIdentity: "cheerful editorial color blocks" }, "Retains the hero, about, services, team, pricing, testimonials, contact, FAQ, and schedule roles; instructors, memberships, and schedule require no role change."],
  ["retro-cli-es", { structuralPattern: "documentation site pattern with hero, features, how-it-works, testimonials, pricing, FAQ, and footer", baselineIdentity: "minimalist, technical, clean, dark mode; code blocks, syntax highlighting, terminal commands, developer-tools UI, charts and graphs, and search bar", requestedIdentity: "retro technical manual with orange ink, not a terminal clone" }, "Retains the hero, features, how-it-works, testimonials, pricing, FAQ, and footer roles; CLI documentation requires no role change."],
  ["component-cloud-en", { structuralPattern: "SaaS product page pattern with hero, features, how-it-works, pricing, testimonials, FAQ, CTA, and footer", baselineIdentity: "minimalist, data-driven, technical, corporate; code snippets, data visualizations, user-interface elements, component-library display, color-palette display, and search bar", requestedIdentity: "expressive modular shapes and electric lime" }, "Retains the hero, features, how-it-works, pricing, testimonials, FAQ, CTA, and footer roles; component delivery workflow requires no role change."],
  ["open-source-observability-es", { structuralPattern: "product landing page pattern with hero, features, how-it-works, testimonials, CTA, and footer", baselineIdentity: "technical showcase, data-driven, minimalist modern; code snippets, data visualizations, performance metrics, dark mode, terminal/workflow/company logos", requestedIdentity: "constructivist print system in red, cream, and black" }, "Retains the hero, features, how-it-works, testimonials, CTA, and footer roles; capabilities, workflow, proof, and contribution require no role change."],
  ["color-photographer-es", { structuralPattern: "portfolio pattern with hero, gallery, about, testimonials, and contact", baselineIdentity: "editorial spread, gallery showcase, minimalist chic; monochromatic palette, clean typography, grid layout, white space, natural light, fashion photography, and portrait photography", requestedIdentity: "saturated duotone and playful captions" }, "Retains the hero, gallery, about, testimonials, and contact roles; cultural projects and biography require no role change."],
  ["literary-newsletter-en", { structuralPattern: "blog pattern with header, CTA, content list, and footer", baselineIdentity: "minimalist, editorial, clean; text-heavy content, monochromatic color palette, simple typography, list layout, CTA buttons, and social media icons", requestedIdentity: "maximal collage and marginalia" }, "Retains the header, CTA, content list, and footer roles; issue list, membership, and author header require no role change."],
  ["friendly-design-portfolio-es", { structuralPattern: "portfolio pattern with hero, about, clients, and contact", baselineIdentity: "expert, minimalist, modernist; dark mode, minimal text, serif fonts, subtle animation, clean typography, negative space, and monochromatic color palette", requestedIdentity: "handmade shapes, warm color, approachable voice" }, "Retains the hero, about, clients, and contact roles; studio presentation, approach, clients, and contact require no role change."],
] as const;

describe("VISUAL_ENGINE_2A_PILOT_CASES", () => {
  it("is a strict, parseable 15-case cohort with the prescribed distribution", () => {
    expect(VisualEngine2APilotCaseSchema.array().length(15).parse(VISUAL_ENGINE_2A_PILOT_CASES)).toEqual(VISUAL_ENGINE_2A_PILOT_CASES);
    expect(VISUAL_ENGINE_2A_DATASET_VERSION).toBe("visual-engine-2a-cohort/1.0");
    expect(new Set(VISUAL_ENGINE_2A_PILOT_CASES.map((caseRow) => caseRow.id)).size).toBe(15);
    expect(new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((caseRow) => caseRow.allowedSkeletonTemplateIds)).size).toBe(15);
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

  it("preserves the reviewed baseline identity and structural rationale for every case", () => {
    expect(VISUAL_ENGINE_2A_PILOT_CASES.map((caseRow) => [
      caseRow.id,
      caseRow.identityConflict,
      caseRow.structuralRationale,
    ])).toEqual(EXPECTED_IDENTITY_AND_STRUCTURE);
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
