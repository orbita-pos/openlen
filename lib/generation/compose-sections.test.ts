import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { CreativeDirectionSchema } from "./creative-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { resolveSectionPlan, SectionCompositionSelectionError } from "./section-inventory";
import { IntentAnalysisSchema } from "./contracts";
import {
  composeAdaptiveSections,
  composeSectionCandidate,
  mapCompositionAdaptationReason,
  type ComposeSectionCandidateDeps,
  type ComposeSectionCandidateInput,
} from "./compose-sections";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";
import type { FillAssembledResult } from "@/lib/assemble/fill";
import type { SectionPlanRow } from "./section-composition-contracts";

const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const sha12 = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 12);

function section(id: string, type: SectionType): SectionRecord {
  const html = `<style>[data-sec="${id}"]{--radius:12px}</style><section data-sec="${id}"><h2>Inherited ${type}</h2></section>`;
  return {
    id, type, name: id, variantLabel: id, rootTag: "section", mode: "cream",
    storageKey: `sections/${id}-${sha12(html)}.html`, storageUrl: `https://storage.invalid/${id}.html`,
    contentHash: sha12(html), size: html.length, designTokens: { "--radius": "12px" },
    fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0", sourceTemplateId: `donor-${id}`,
      sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: 0,
      extractionVersion: "template-band-extractor/1.0", sourceHash: `sha256:${"a".repeat(64)}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(id).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0", role: type,
      layoutArchetypes: ["centered"], domains: ["children_creativity"], audiences: ["children"], moods: ["playful"], negativeSignals: [],
    },
    status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  };
}

const RECORDS = [
  section("navbar-11", "navbar"), section("hero-11", "hero"), section("gallery-11", "gallery"),
  section("features-11", "features"), section("features-12", "features"), section("features-13", "features"),
  section("footer-11", "footer"),
];
const HTML_BY_URL = new Map(RECORDS.map((row) => [row.storageUrl,
  `<style>[data-sec="${row.id}"]{--radius:12px}</style><section data-sec="${row.id}"><h2>Inherited ${row.type}</h2></section>`,
]));

const INPUT: ComposeSectionCandidateInput = {
  route: "section_composition",
  projectId: "project-1",
  assetMode: "curated",
  intent: IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0", language: "es",
    functional: { siteType: "content_platform", requiredSections: ["hero", "coloring_gallery", "minigames", "stories", "activities"], primaryActions: ["color"], contentModel: "creative_activities" },
    audience: { primary: "children", ageRange: "age_4_9", secondary: ["parents"] },
    domains: ["creative_play"], emotionalGoals: ["playful", "magical"],
    requiredVisualSignals: ["coloring_art"], forbiddenVisualSignals: ["corporate_dashboard"],
    explicitConstraints: [], ambiguities: [], confidence: 0.96,
  }),
  intentHash: `sha256:${"a".repeat(64)}`,
  records: RECORDS,
  copy: {
    business_name: "PintaMundo", industry: "creative_play", tagline_es: "Colorea tu imaginación", tagline_en: null,
    pitch: "Páginas, juegos, cuentos y actividades para crear.", hero_keyword: "colorear",
    features: [{ title: "Minijuegos", desc: "Juega y crea." }, { title: "Cuentos", desc: "Historias mágicas." }, { title: "Actividades", desc: "Ideas para imaginar." }],
    pricing: [], testimonials: [], cta_primary: "Empezar a colorear", cta_secondary: null, faq_questions: [], language_detected: "es", contact: null,
  },
  brand: { accent: "#F06AA6" },
};

function successfulDeps(): ComposeSectionCandidateDeps {
  return {
    fetchText: async (url) => HTML_BY_URL.get(url) ?? null,
    fillAssembled: async (html): Promise<FillAssembledResult> => ({
      html, filled: true, appliedOps: 12, durationMs: 1, leaksBefore: 0, leaksAfter: 0,
    }),
    normalizeBornCanonical: (html) => html,
    adaptTemplateSkeleton: async (input) => ({
      ok: true, status: "adapted",
      html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'),
      creativeDirectionVersion: "creative-direction/1.0", planVersion: "skeleton-adaptation-plan/1.0",
      creativeDirection: DIRECTION, promptVersion: "creative-direction/1.7", modelId: "fixture-model",
      structuralFingerprintBefore: `sha256:${"b".repeat(64)}`,
      structuralFingerprintAfter: `sha256:${"b".repeat(64)}`,
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, cachedTokens: 0 }, durationMs: 4,
    }),
  };
}

function generatedGallery() {
  const html = '<section data-sec="generated-gallery"><h2>Galería creativa</h2></section>';
  return {
    id: "generated-gallery", html, type: "gallery" as const, mode: "cream" as const,
    contentHash: sha12(html), radiusBucket: "unknown" as const, density: "medium" as const,
    needsJs: false, assetCapability: "none" as const,
    semanticProfile: { tags: ["playful", "illustrated"] as const, source: "derived_metadata" as const },
    sourceKind: "generated" as const, sourceTemplateId: null, sourceBandOrdinal: null,
    structuralFingerprint: `sha256:${"9".repeat(64)}`,
    derivedSemantics: { schemaVersion: "derived-section-semantics/1.0" as const, role: "gallery" as const, layoutArchetypes: ["gallery" as const], domains: ["children_creativity" as const], audiences: ["children" as const], moods: ["playful" as const], negativeSignals: [] },
    specHash: `sha256:${"8".repeat(64)}`,
  };
}

describe("composeSectionCandidate", () => {
  it("exports the adaptive atomic composition entrypoint", () => {
    expect(composeAdaptiveSections).toBeTypeOf("function");
  });

  it("adds one mobile-safety style before creative adaptation without changing roles", async () => {
    const deps = successfulDeps();
    const adapt = deps.adaptTemplateSkeleton!;
    deps.adaptTemplateSkeleton = vi.fn(async (input, adaptDeps) => {
      expect(input.html.match(/data-openlen-composition-safety="mobile\/1\.0"/g)).toHaveLength(1);
      expect(input.html.match(/data-openlen-role=/g)).toHaveLength(7);
      return adapt(input, adaptDeps);
    });

    await expect(composeSectionCandidate(INPUT, deps)).resolves.toMatchObject({ ok: true });
  });

  it("uses a skeleton-safe composition id without CSS-like colon syntax", async () => {
    const deps = successfulDeps();
    const adapt = deps.adaptTemplateSkeleton!;
    deps.adaptTemplateSkeleton = vi.fn(async (input, adaptDeps) => {
      expect(input.templateId).toMatch(/^composition-[a-f0-9]{64}$/);
      expect(input.templateId).not.toContain(":");
      return adapt(input, adaptDeps);
    });

    await expect(composeSectionCandidate(INPUT, deps)).resolves.toMatchObject({ ok: true });
  });

  it("passes the same project asset context to the shared skeleton adapter", async () => {
    const deps = successfulDeps();
    const adapt = deps.adaptTemplateSkeleton!;
    deps.adaptTemplateSkeleton = vi.fn(async (input, adaptDeps) => {
      expect(input.assetContext).toEqual({ mode: "curated", projectId: "project-1" });
      return adapt(input, adaptDeps);
    });
    await expect(composeSectionCandidate(INPUT, deps)).resolves.toMatchObject({ ok: true });
    expect(deps.adaptTemplateSkeleton).toHaveBeenCalledTimes(1);
  });

  it("passes a deterministic illustrated direction into section selection", async () => {
    const deps = successfulDeps();
    deps.resolvePlan = vi.fn((plan, inventory, context) => {
      expect(context.intent).toEqual(INPUT.intent);
      expect(context.direction.visualArchetype).toBe("illustrated_activity_book");
      return resolveSectionPlan(plan, inventory, context);
    });
    await expect(composeSectionCandidate(INPUT, deps)).resolves.toMatchObject({ ok: true });
    expect(deps.resolvePlan).toHaveBeenCalledTimes(1);
  });

  it("generates only a missing role, then re-enters selection with real donor diversity", async () => {
    const deps = successfulDeps();
    const generateMissing = vi.fn(async () => ({
      ok: true as const,
      candidate: generatedGallery(),
      modelId: "fixture", promptVersion: "generated-section-spec-prompt/1.0" as const, durationMs: 1,
    }));
    const result = await composeSectionCandidate({ ...INPUT, records: RECORDS.filter((record) => record.type !== "gallery") }, { ...deps, generateMissing });
    expect(result).toMatchObject({ ok: true, manifest: { selectedSourceKinds: expect.arrayContaining(["generated"]) } });
    expect(generateMissing).toHaveBeenCalledTimes(1);
    expect(generateMissing).toHaveBeenCalledWith(expect.objectContaining({ row: expect.objectContaining({ componentType: "gallery" }) }));
  });

  it("never calls generation when compatible donors already exist", async () => {
    const generateMissing = vi.fn();
    await expect(composeSectionCandidate(INPUT, { ...successfulDeps(), generateMissing })).resolves.toMatchObject({ ok: true });
    expect(generateMissing).not.toHaveBeenCalled();
  });

  it("replaces only a selected fragment whose stored bytes are unavailable", async () => {
    const deps = successfulDeps();
    deps.fetchText = async (url) => url.endsWith("gallery-11.html") ? null : HTML_BY_URL.get(url) ?? null;
    const generateMissing = vi.fn(async () => ({
      ok: true as const, candidate: generatedGallery(), modelId: "fixture",
      promptVersion: "generated-section-spec-prompt/1.0" as const, durationMs: 1,
    }));
    const result = await composeSectionCandidate(INPUT, { ...deps, generateMissing });
    expect(result).toMatchObject({ ok: true, generatedSectionCount: 1 });
    expect(generateMissing).toHaveBeenCalledTimes(1);
  });

  it("never generates for stale inventory or an invalid fetched fragment", async () => {
    const generateMissing = vi.fn();
    await expect(composeSectionCandidate(INPUT, {
      ...successfulDeps(), generateMissing,
      buildInventory: () => { throw new SectionCompositionSelectionError("section_inventory_stale"); },
    })).resolves.toMatchObject({ ok: false, reasonCode: "section_inventory_stale" });
    expect(generateMissing).not.toHaveBeenCalled();
    await expect(composeSectionCandidate(INPUT, {
      ...successfulDeps(), generateMissing,
      fetchFragments: async () => ({ ok: false as const, code: "section_fragment_invalid" as const }),
    })).resolves.toMatchObject({ ok: false, reasonCode: "section_fragment_invalid" });
    expect(generateMissing).not.toHaveBeenCalled();
  });

  it("caps missing-section generation at two roles with no retries", async () => {
    const rows = [
      { ordinal: 0, requestedRole: "hero", componentType: "hero", compatibilityKind: "exact", compatibilityScore: 1, compatibilityRuleId: "section_component:exact:hero", required: true },
      { ordinal: 1, requestedRole: "stories", componentType: "about", compatibilityKind: "structural", compatibilityScore: 0.85, compatibilityRuleId: "section_component:structural:stories>about", required: true },
      { ordinal: 2, requestedRole: "activities", componentType: "features", compatibilityKind: "structural", compatibilityScore: 0.85, compatibilityRuleId: "section_component:structural:activities>features", required: true },
    ] as const;
    let attempts = 0;
    const generateMissing = vi.fn(async ({ row }: { row: SectionPlanRow }) => {
      const html = `<section data-sec="generated-${row.componentType}">${row.requestedRole}</section>`;
      return { ok: true as const, candidate: {
        ...generatedGallery(), id: `generated-${row.componentType}`, html, type: row.componentType,
        contentHash: sha12(html), structuralFingerprint: `sha256:${String(attempts).repeat(64)}`,
      }, modelId: "fixture", promptVersion: "generated-section-spec-prompt/1.0" as const, durationMs: 1 };
    });
    const result = await composeSectionCandidate(INPUT, {
      ...successfulDeps(), generateMissing,
      resolvePlan: () => { throw new SectionCompositionSelectionError("section_semantic_coverage_failed", rows[Math.min(attempts++, 2)]); },
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "section_semantic_coverage_failed" });
    expect(generateMissing).toHaveBeenCalledTimes(2);
  });

  it("passes the shadow trace sink to skeleton adaptation", async () => {
    const sink = vi.fn();
    const deps = successfulDeps();
    const adapt = deps.adaptTemplateSkeleton!;
    deps.adaptTemplateSkeleton = vi.fn((input, adaptDeps) => adapt(input, adaptDeps));
    await expect(composeSectionCandidate({ ...INPUT, assetTraceSink: sink }, deps)).resolves.toMatchObject({ ok: true });
    expect(deps.adaptTemplateSkeleton).toHaveBeenCalledWith(expect.anything(), { onAssetTrace: sink });
  });
  it("stitches, fills, adapts and returns one redacted manifest", async () => {
    const result = await composeSectionCandidate(INPUT, successfulDeps());
    expect(result).toMatchObject({
      ok: true, status: "composed", creativeDirection: DIRECTION,
      manifest: {
        schemaVersion: "section-composition-manifest/2.0",
        orderedRoles: ["header", "hero", "coloring_gallery", "minigames", "stories", "activities", "footer"],
        selectedSectionIds: expect.arrayContaining(["navbar-11", "hero-11", "gallery-11", "footer-11"]),
        resultCode: "composed",
      },
    });
    expect(result.ok && result.html).toContain('data-openlen-role="stories"');
    expect(JSON.stringify(result.manifest)).not.toContain("PintaMundo");
    expect(JSON.stringify(result.manifest)).not.toContain("storage.invalid");
  });

  it("rejects a route that did not explicitly select composition before any work", async () => {
    const deps = successfulDeps();
    deps.buildInventory = vi.fn();
    const result = await composeSectionCandidate({ ...INPUT, route: "template_skeleton" }, deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "route_ineligible" });
    expect(deps.buildInventory).not.toHaveBeenCalled();
  });

  it("stops atomically when inherited source copy remains", async () => {
    const deps = successfulDeps();
    deps.fillAssembled = async (html) => ({ html, filled: true, appliedOps: 1, durationMs: 1, leaksBefore: 2, leaksAfter: 1 });
    deps.adaptTemplateSkeleton = vi.fn();
    const result = await composeSectionCandidate(INPUT, deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "inherited_copy_leak" });
    expect(deps.adaptTemplateSkeleton).not.toHaveBeenCalled();
  });

  it("stops before assembly when the selected fragment becomes stale", async () => {
    const deps = successfulDeps();
    deps.fetchFragments = async () => ({ ok: false, code: "section_fragment_stale" });
    deps.assembleDocument = vi.fn();
    const result = await composeSectionCandidate(INPUT, deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "section_fragment_stale" });
    expect(deps.assembleDocument).not.toHaveBeenCalled();
  });

  it("rejects post-adaptation role loss without exposing partial HTML", async () => {
    const deps = successfulDeps();
    const adapt = deps.adaptTemplateSkeleton!;
    deps.adaptTemplateSkeleton = async (input, adaptDeps) => {
      const result = await adapt(input, adaptDeps);
      return result.ok ? { ...result, html: result.html.replace(' data-openlen-role="stories"', "") } : result;
    };
    const result = await composeSectionCandidate(INPUT, deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "section_role_coverage_failed" });
    expect(result).not.toHaveProperty("html");
  });

  it("maps every existing 2A failure into the bounded 2B vocabulary", () => {
    expect(mapCompositionAdaptationReason("provider_timeout")).toBe("provider_timeout");
    expect(mapCompositionAdaptationReason("asset_slot_unavailable")).toBe("required_asset_unavailable");
    expect(mapCompositionAdaptationReason("cannot_add_required_signal")).toBe("model_incompatible");
    expect(mapCompositionAdaptationReason("structural_invariant_failed")).toBe("section_role_coverage_failed");
    expect(mapCompositionAdaptationReason("insufficient_style_hooks")).toBe("model_incompatible");
  });

  it("redacts unexpected exceptions into internal_error", async () => {
    const deps = successfulDeps();
    deps.fillAssembled = async () => { throw new Error("secret provider body"); };
    const result = await composeSectionCandidate(INPUT, deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "internal_error" });
    expect(JSON.stringify(result)).not.toContain("secret provider body");
  });
});
