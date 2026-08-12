import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { CreativeDirectionSchema } from "./creative-contracts";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { IntentAnalysisSchema } from "./contracts";
import {
  composeSectionCandidate,
  mapCompositionAdaptationReason,
  type ComposeSectionCandidateDeps,
  type ComposeSectionCandidateInput,
} from "./compose-sections";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";
import type { FillAssembledResult } from "@/lib/assemble/fill";

const DIRECTION = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const sha12 = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 12);

function section(id: string, type: SectionType): SectionRecord {
  const html = `<style>[data-sec="${id}"]{--radius:12px}</style><section data-sec="${id}"><h2>Inherited ${type}</h2></section>`;
  return {
    id, type, name: id, variantLabel: id, rootTag: "section", mode: "cream",
    storageKey: `sections/${id}-${sha12(html)}.html`, storageUrl: `https://storage.invalid/${id}.html`,
    contentHash: sha12(html), size: html.length, designTokens: { "--radius": "12px" },
    fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  };
}

const RECORDS = [
  section("navbar-01", "navbar"), section("hero-01", "hero"), section("gallery-01", "gallery"),
  section("features-01", "features"), section("features-02", "features"), section("features-03", "features"),
  section("footer-01", "footer"),
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

describe("composeSectionCandidate", () => {
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
        schemaVersion: "section-composition-manifest/1.0",
        orderedRoles: ["header", "hero", "coloring_gallery", "minigames", "stories", "activities", "footer"],
        selectedSectionIds: ["navbar-01", "hero-01", "gallery-01", "features-01", "features-02", "features-03", "footer-01"],
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
