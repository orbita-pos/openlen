import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { AI_HYBRID_POLICY_VERSION } from "@/lib/curate/ai-creation-contracts";
import { runAiCreation, type RunAiCreationDeps } from "@/lib/curate/run-ai-creation";
import { SectionCompositionManifestSchema } from "./section-composition-contracts";
import { canonicalJsonSha256, sha256 } from "./content-hash";
import { AI_HYBRID_NICHE_CASES } from "./ai-hybrid-niche-cohort";
import { planSectionComposition } from "./section-plan";
import {
  buildSectionCompositionInventory,
  resolveSectionPlan,
} from "./section-inventory";
import {
  buildSectionSemanticPolicy,
  scoreSectionSemanticProfile,
} from "./section-variant-semantics";
import { buildDeterministicCreativeDirection } from "./deterministic-creative-direction";
import { SECTION_TYPES } from "@/lib/sections/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";

const INTENT_HASH = `sha256:${"a".repeat(64)}`;
const INVENTORY_HASH = `sha256:${"b".repeat(64)}`;
const EXPECTED_IDS = {
  "kids-coloring": ["kids-coloring-header", "kids-coloring-hero", "kids-coloring-coloring_gallery", "kids-coloring-minigames", "kids-coloring-stories", "kids-coloring-activities", "kids-coloring-footer"],
  "horror-experience": ["horror-experience-header", "horror-experience-hero", "horror-experience-about", "horror-experience-gallery", "horror-experience-events", "horror-experience-call_to_action", "horror-experience-footer"],
  "comedy-club": ["comedy-club-header", "comedy-club-hero", "comedy-club-events", "comedy-club-about", "comedy-club-booking", "comedy-club-contact", "comedy-club-footer"],
  "video-game-launch": ["video-game-launch-header", "video-game-launch-hero", "video-game-launch-features", "video-game-launch-how_it_works", "video-game-launch-gallery", "video-game-launch-call_to_action", "video-game-launch-footer"],
  "school-website": ["school-website-header", "school-website-hero", "school-website-programs", "school-website-about", "school-website-events", "school-website-contact", "school-website-footer"],
  "cooking-publication": ["cooking-publication-header", "cooking-publication-hero", "cooking-publication-featured_content", "cooking-publication-content_list", "cooking-publication-newsletter", "cooking-publication-footer"],
  "physical-product-sale": ["physical-product-sale-header", "physical-product-sale-hero", "physical-product-sale-products", "physical-product-sale-features", "physical-product-sale-testimonials", "physical-product-sale-faq", "physical-product-sale-call_to_action", "physical-product-sale-footer"],
} as const;

const POSITIVE_LABELS = {
  "kids-coloring": "Illustrated Creator Playground Playful",
  "horror-experience": "Cinematic Editorial",
  "comedy-club": "Event Marquee Photo Playful",
  "video-game-launch": "Cinematic Game Illustrated",
  "school-website": "School Community Warm Photo Editorial",
  "cooking-publication": "Editorial Warm Photo Tactile",
  "physical-product-sale": "Product Commerce Photo Tactile",
} as const;

const FORBIDDEN_LABELS = {
  "kids-coloring": "Analytics Dashboard Software Mockup",
  "horror-experience": "Game UI",
  "comedy-club": "Corporate",
  "video-game-launch": "Developer Terminal Documentation",
  "school-website": "Course UI Dashboard",
  "cooking-publication": "Ecommerce Grid Wellness Dashboard",
  "physical-product-sale": "Analytics Dashboard Software Mockup",
} as const;

function semanticRecord(input: {
  id: string;
  type: SectionType;
  name: string;
  variantLabel: string;
  domain?: "children_creativity" | "cooking" | "education" | "entertainment_horror" | "physical_product" | "professional_services";
  negativeSignals?: Array<"analytics" | "corporate" | "course_ui" | "dashboard" | "developer_tool" | "documentation" | "game_ui" | "commerce_grid" | "software_mockup" | "terminal" | "wellness">;
  layout?: "centered" | "editorial" | "marquee";
  mood?: "playful" | "cinematic" | "warm";
}): SectionRecord {
  const html = `<section data-sec="${input.id}">${input.id}</section>`;
  const contentHash = createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
  return {
    ...input,
    rootTag: "section",
    mode: "light",
    storageKey: `sections/${input.id}-${contentHash}.html`,
    storageUrl: `memory://${input.id}`,
    contentHash,
    size: html.length,
    designTokens: null,
    fonts: null,
    needsJs: false,
    hasPlaceholders: false,
    thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0", sourceTemplateId: input.id,
      sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: 0,
      extractionVersion: "template-band-extractor/1.0", sourceHash: `sha256:${"a".repeat(64)}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(input.id).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0", role: input.type,
      layoutArchetypes: [input.layout ?? "centered"], domains: input.domain ? [input.domain] : [],
      audiences: [], moods: input.mood ? [input.mood] : [], negativeSignals: input.negativeSignals ?? [],
    },
    status: "published",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: new Date(0),
  };
}

function semanticCatalog(row: (typeof AI_HYBRID_NICHE_CASES)[number]): SectionRecord[] {
  const positive = {
    "kids-coloring": { domain: "children_creativity", mood: "playful" },
    "horror-experience": { domain: "entertainment_horror", mood: "cinematic" },
    "comedy-club": { domain: "professional_services", mood: "playful", layout: "marquee" },
    "video-game-launch": { domain: "entertainment_horror", mood: "cinematic" },
    "school-website": { domain: "education", mood: "warm" },
    "cooking-publication": { domain: "cooking", mood: "warm", layout: "editorial" },
    "physical-product-sale": { domain: "physical_product", mood: "warm" },
  }[row.id] as Pick<Parameters<typeof semanticRecord>[0], "domain" | "mood" | "layout">;
  const forbidden = {
    "kids-coloring": ["analytics", "dashboard", "software_mockup"],
    "horror-experience": ["game_ui"],
    "comedy-club": ["corporate"],
    "video-game-launch": ["developer_tool", "documentation", "terminal"],
    "school-website": ["course_ui", "dashboard"],
    "cooking-publication": ["commerce_grid", "wellness", "dashboard"],
    "physical-product-sale": ["analytics", "dashboard", "software_mockup"],
  }[row.id] as Parameters<typeof semanticRecord>[0]["negativeSignals"];
  const counts = new Map<SectionType, number>();
  for (const type of row.expectedComponents) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].flatMap(([type, count]) => {
    const forbiddenId = row.id === "kids-coloring" && (type === "hero" || type === "features")
      ? `${type}-01`
      : `${type}-forbidden-${row.id}`;
    return [
      semanticRecord({
        id: forbiddenId,
        type,
        name: FORBIDDEN_LABELS[row.id],
        variantLabel: "Forbidden",
        negativeSignals: forbidden,
      }),
      ...Array.from({ length: count }, (_, index) => semanticRecord({
        id: `${type}-semantic-${index + 1}-${row.id}`,
        type,
        name: POSITIVE_LABELS[row.id],
        variantLabel: "Reviewed semantic fit",
        ...positive,
      })),
      semanticRecord({
        id: `${type}-neutral-${row.id}`,
        type,
        name: "Aurora",
        variantLabel: "Neutral",
      }),
    ];
  });
}

function successDeps(row: (typeof AI_HYBRID_NICHE_CASES)[number]): Required<RunAiCreationDeps> {
  const planning = planSectionComposition({
    intent: row.intent,
    intentHash: INTENT_HASH,
    inventoryHash: INVENTORY_HASH,
    availableTypes: new Set(SECTION_TYPES),
  });
  if (!planning.ok) throw new Error(planning.code);
  const selectedSectionIds = [...EXPECTED_IDS[row.id]];
  const html = `<!doctype html><html><head><style data-openlen-visual-engine="creative-direction/1.0"></style></head><body>${planning.plan.rows.map((planRow, index) => `<section data-sec="${selectedSectionIds[index]}" data-openlen-role="${planRow.requestedRole}"><h2>${row.id} ${planRow.requestedRole}</h2></section>`).join("")}</body></html>`;
  const visualEngine = {
    schemaVersion: "visual-engine-project/1.0" as const,
    route: "section_composition" as const,
    templateId: null,
    creativeDirection: row.expectedCreativeDirection,
    promptVersion: "creative-prompt/1.0",
    policyVersion: AI_HYBRID_POLICY_VERSION,
    contractVersion: "creative-direction/1.0" as const,
    compositionManifest: SectionCompositionManifestSchema.parse({
      schemaVersion: "section-composition-manifest/2.0",
      intentHash: canonicalJsonSha256(row.intent),
      creativeDirectionHash: canonicalJsonSha256(row.expectedCreativeDirection),
      inventoryHash: INVENTORY_HASH,
      orderedRoles: planning.plan.rows.map((planRow) => planRow.requestedRole),
      selectedSectionIds,
      selectedContentHashes: planning.plan.rows.map((_planRow, index) => (index + 1).toString(16).padStart(12, "0")),
      selectedSourceKinds: planning.plan.rows.map(() => "template_derived" as const),
      selectedSourceTemplateIds: planning.plan.rows.map((_planRow, index) => `donor-${index}`),
      selectedSourceBandOrdinals: planning.plan.rows.map(() => 0),
      selectedStructuralFingerprints: planning.plan.rows.map((_planRow, index) => `sha256:${(index + 1).toString(16).repeat(64).slice(0, 64)}`),
      compatibilityRuleIds: planning.plan.rows.map((planRow) => planRow.compatibilityRuleId),
      outputHash: sha256(html),
      resultCode: "composed",
    }),
  };
  return {
    listSections: vi.fn(async () => [{ id: "fixture" }] as never),
    fetchText: vi.fn(async () => null),
    renderViewports: vi.fn() as never,
    resolveImage: vi.fn() as never,
    createFableRuntimeComposition: (() => ({
      recordModel: vi.fn(), recordImage: vi.fn(), recordDegraded: vi.fn(),
      recordFailure: vi.fn(async () => undefined), recordDelivered: vi.fn(async () => undefined),
    })) as never,
    fableRuntimeOptions: undefined as never,
    creativeGenerationDeps: {} as never,
    // The composed candidate is the fixture; this asserts what the delivery
    // contract does with per-niche metadata, not how the page was built.
    runCreativeGeneration: vi.fn(async () => ({
      ok: true as const, route: "section_composition" as const, templateId: null,
      title: row.id, html, visualEngine, filled: true, appliedOps: 1, degraded: false,
    })) as never,
  };
}

describe("AI hybrid niche cohort", () => {
  it("defines the exact immutable seven-case release cohort", () => {
    expect(AI_HYBRID_NICHE_CASES.map((row) => row.id)).toEqual([
      "kids-coloring",
      "horror-experience",
      "comedy-club",
      "video-game-launch",
      "school-website",
      "cooking-publication",
      "physical-product-sale",
    ]);
    for (const row of AI_HYBRID_NICHE_CASES) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.intent)).toBe(true);
      expect(Object.isFrozen(row.expectedCreativeDirection)).toBe(true);
      expect(Object.isFrozen(row.expectedRoles)).toBe(true);
      expect(Object.isFrozen(row.expectedComponents)).toBe(true);
    }
    expect(AI_HYBRID_NICHE_CASES[0]).toMatchObject({
      forbiddenVisualSignals: ["saas_dashboard", "course_progress_ui", "corporate_photography"],
      forbiddenResidues: ["Lyceum", "Python", "JavaScript", "cURL", "Common Core", "IB curriculum", "tutoring plan"],
    });
  });

  it.each(AI_HYBRID_NICHE_CASES)("plans exact supported roles and components for $id", (row) => {
    const result = planSectionComposition({
      intent: row.intent,
      intentHash: INTENT_HASH,
      inventoryHash: INVENTORY_HASH,
      availableTypes: new Set(SECTION_TYPES),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.plan.rows.map(({ requestedRole }) => requestedRole)).toEqual(row.expectedRoles);
    expect(result.plan.rows.map(({ componentType }) => componentType)).toEqual(row.expectedComponents);
    expect(result.plan.rows).toHaveLength(row.intent.functional.requiredSections.length + 2);
  });

  it.each(AI_HYBRID_NICHE_CASES)("selects semantically compatible fragments for $id", (row) => {
    const inventory = buildSectionCompositionInventory(semanticCatalog(row));
    const planning = planSectionComposition({
      intent: row.intent,
      intentHash: canonicalJsonSha256(row.intent),
      inventoryHash: inventory.hash,
      availableTypes: new Set(inventory.entries.map(({ type }) => type)),
    });
    expect(planning.ok).toBe(true);
    if (!planning.ok) throw new Error(planning.code);
    const direction = buildDeterministicCreativeDirection(row.intent).direction;
    const selection = resolveSectionPlan(planning.plan, inventory, { intent: row.intent, direction });
    const policy = buildSectionSemanticPolicy(row.intent, direction);
    const selectedEntries = selection.map((selected) =>
      inventory.entries.find((entry) => entry.id === selected.sectionId)!);

    expect(new Set(selection.map(({ contentHash }) => contentHash)).size).toBeGreaterThanOrEqual(3);
    expect(selectedEntries.every((entry) =>
      scoreSectionSemanticProfile(entry.semanticProfile, policy).eligible)).toBe(true);
    expect(selection.every(({ sectionId }) => sectionId.endsWith("-01"))).toBe(false);

    if (row.id === "kids-coloring") {
      const ids = selection.map(({ sectionId }) => sectionId);
      const tags = selectedEntries.flatMap(({ semanticProfile }) => semanticProfile.tags);
      expect(ids).not.toContain("hero-01");
      expect(ids).not.toContain("features-01");
      expect(tags.some((tag) => ["creator", "illustrated", "playful"].includes(tag))).toBe(true);
    }
  });

  it.each(AI_HYBRID_NICHE_CASES)("delivers only coherent composition metadata for $id", async (row) => {
    const deps = successDeps(row);
    const result = await runAiCreation({
      projectId: `project-${row.id}`,
      brief: row.brief,
      profileData: {} as BusinessProfileData,
    }, deps);

    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null });
    expect(deps.runCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ brief: row.brief, records: [{ id: "fixture" }] }),
      expect.any(Object),
    );
    if (!result.ok) throw new Error(result.reasonCode);
    expect(Object.keys(result.visualEngine).sort()).toEqual([
      "compositionManifest", "contractVersion", "creativeDirection", "policyVersion",
      "promptVersion", "route", "schemaVersion", "templateId",
    ]);
    expect(result.visualEngine.compositionManifest.orderedRoles).toEqual(row.expectedRoles);
    expect(result.visualEngine.compositionManifest.selectedSectionIds).toEqual([...EXPECTED_IDS[row.id]]);
    expect(new Set(result.visualEngine.compositionManifest.selectedSectionIds).size).toBe(row.expectedRoles.length);
    expect(result.visualEngine.creativeDirection.requiredVisualSignals).toEqual(expect.arrayContaining([...row.requiredVisualSignals]));
    expect(result.visualEngine.creativeDirection.forbiddenVisualSignals).toEqual(expect.arrayContaining([...row.forbiddenVisualSignals]));
    for (const forbiddenSignal of row.forbiddenVisualSignals) {
      expect(result.visualEngine.creativeDirection.requiredVisualSignals).not.toContain(forbiddenSignal);
    }
    expect(result.visualEngine.compositionManifest.creativeDirectionHash).toBe(canonicalJsonSha256(result.visualEngine.creativeDirection));
    for (const residue of row.forbiddenResidues) expect(result.html).not.toContain(residue);
  });
});
