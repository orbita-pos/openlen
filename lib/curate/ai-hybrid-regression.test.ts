import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/content-hash";
import {
  buildSectionCompositionInventory,
  fetchVerifiedSectionFragments,
} from "@/lib/generation/section-inventory";
import { SectionCompositionManifestSchema } from "@/lib/generation/section-composition-contracts";
import type { SectionRecord } from "@/lib/sections/store";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import { AI_HYBRID_POLICY_VERSION } from "./ai-creation-contracts";
import { runAiCreation, type RunAiCreationDeps } from "./run-ai-creation";

const LEGACY_HTML = '<!doctype html><html><head><title>Lyceum tutoring plan</title></head><body><section data-sec="hero-legacy"><h1>Common Core and IB curriculum</h1><pre>Python JavaScript cURL</pre></section></body></html>';

function withForbiddenWholeTemplateLoader<T extends object>(
  deps: T,
  loadWholeTemplate: () => string,
): T & { readonly loadWholeTemplate: () => string } {
  const injected = { ...deps, loadWholeTemplate };
  return new Proxy(injected, {
    get(target, property, receiver) {
      if (property === "loadWholeTemplate") loadWholeTemplate();
      return Reflect.get(target, property, receiver);
    },
  });
}

function recordFor(html: string): SectionRecord {
  const hash = createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
  return {
    id: "hero-legacy",
    type: "hero",
    name: "Legacy hero",
    variantLabel: "Legacy",
    rootTag: "section",
    mode: "light",
    storageKey: `sections/hero-legacy-${hash}.html`,
    storageUrl: "memory://legacy",
    contentHash: hash,
    size: html.length,
    designTokens: null,
    fonts: null,
    needsJs: false,
    hasPlaceholders: false,
    thumbnailUrl: null,
    status: "published",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: new Date(0),
  };
}

describe("Mundo Pincel hybrid-only regression", () => {
  it("rejects a hash-valid Lyceum document disguised as a section without reaching a whole-template loader", async () => {
    const loadWholeTemplate = vi.fn(() => LEGACY_HTML);
    const inventory = buildSectionCompositionInventory([recordFor(LEGACY_HTML)]);
    const entry = inventory.entries[0]!;

    const result = await fetchVerifiedSectionFragments([{
      ordinal: 0,
      requestedRole: "hero",
      componentType: "hero",
      compatibilityKind: "exact",
      compatibilityScore: 1,
      compatibilityRuleId: "section_component:exact:hero",
      required: true,
      inventoryHash: inventory.hash,
      sectionId: entry.id,
      contentHash: entry.contentHash,
    }], inventory, withForbiddenWholeTemplateLoader({
      fetchText: vi.fn(async () => LEGACY_HTML),
    }, loadWholeTemplate));

    expect(result).toEqual({ ok: false, code: "section_fragment_invalid" });
    expect(loadWholeTemplate).not.toHaveBeenCalled();
  });

  it("delivers a clean Mundo Pincel section composition and never loads Lyceum", async () => {
    const coloring = AI_HYBRID_NICHE_CASES[0];
    const sectionIds = coloring.expectedRoles.map((role) => `mundo-${role}`);
    const html = `<!doctype html><html><head><style data-openlen-visual-engine="creative-direction/1.0"></style></head><body>${coloring.expectedRoles.map((role, index) => `<section data-sec="${sectionIds[index]}" data-openlen-role="${role}"><h2>Mundo Pincel ${role}</h2></section>`).join("")}</body></html>`;
    const visualEngine = {
      schemaVersion: "visual-engine-project/1.0" as const,
      route: "section_composition" as const,
      templateId: null,
      creativeDirection: coloring.expectedCreativeDirection,
      promptVersion: "creative-prompt/1.0",
      policyVersion: AI_HYBRID_POLICY_VERSION,
      contractVersion: "creative-direction/1.0" as const,
      compositionManifest: SectionCompositionManifestSchema.parse({
        schemaVersion: "section-composition-manifest/2.0",
        intentHash: canonicalJsonSha256(coloring.intent),
        creativeDirectionHash: canonicalJsonSha256(coloring.expectedCreativeDirection),
        inventoryHash: `sha256:${"b".repeat(64)}`,
        orderedRoles: coloring.expectedRoles,
        selectedSectionIds: sectionIds,
        selectedContentHashes: coloring.expectedRoles.map((_role, index) => (index + 1).toString(16).padStart(12, "0")),
        selectedSourceKinds: coloring.expectedRoles.map(() => "template_derived" as const),
        selectedSourceTemplateIds: coloring.expectedRoles.map((_role, index) => `donor-${index}`),
        selectedSourceBandOrdinals: coloring.expectedRoles.map(() => 0),
        selectedStructuralFingerprints: coloring.expectedRoles.map((_role, index) => `sha256:${(index + 1).toString(16).repeat(64).slice(0, 64)}`),
        compatibilityRuleIds: coloring.expectedRoles.map((role) => role === "header" ? "section_component:alias:header>navbar" : role === "footer" ? "section_component:exact:footer" : `section_component:structural:${role}>features`),
        outputHash: sha256(html),
        resultCode: "composed",
      }),
    };
    const loadWholeTemplate = vi.fn(() => LEGACY_HTML);
    const copy = coerceBusinessData({ business_name: "Mundo Pincel" });
    const deps = withForbiddenWholeTemplateLoader<Required<RunAiCreationDeps>>({
      analyzeIntent: vi.fn(async () => ({ ok: true as const, intent: coloring.intent, modelId: "intent-fixture", promptVersion: "intent-prompt/1.8" as const, durationMs: 1 })),
      generatePageCopy: vi.fn(async () => ({ ok: true as const, copy, modelId: "copy-fixture", promptVersion: "page-copy-prompt/1.0" as const, durationMs: 1 })),
      listSections: vi.fn(async () => [{ id: "fixture" }] as never),
      overlayProfile: vi.fn((copy) => copy),
      runSectionCompositionCandidate: vi.fn(async () => ({ ok: true as const, route: "section_composition" as const, templateId: null, html, visualEngine, filled: true, appliedOps: 1, durationMs: 1, leaksBefore: 0, leaksAfter: 0, fableVisualRepairHandoff: {} as never })),
      validateAiCompositionDelivery: vi.fn(({ visualEngine: metadata }) => ({ ok: true as const, visualEngine: metadata as typeof visualEngine })),
      runFableFinalVisualGate: vi.fn(async (input) => ({ ok: true as const, candidate: input.candidate, repaired: false })),
      createFableRuntimeComposition: vi.fn() as never,
    }, loadWholeTemplate);

    const result = await runAiCreation({ projectId: "mundo-pincel", brief: coloring.brief, profileData: coerceBusinessData({}), assetMode: "hybrid" }, deps);

    expect(loadWholeTemplate).not.toHaveBeenCalled();
    expect(deps.runSectionCompositionCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ assetMode: "hybrid" }),
    );
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null });
    if (!result.ok) throw new Error(result.reasonCode);
    for (const residue of coloring.forbiddenResidues) expect(result.html).not.toContain(residue);
  });
});
