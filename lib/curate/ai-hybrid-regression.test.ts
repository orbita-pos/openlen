import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import {
  buildSectionCompositionInventory,
  fetchVerifiedSectionFragments,
} from "@/lib/generation/section-inventory";
import type { SectionRecord } from "@/lib/sections/store";
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

// Every donor body carries Lyceum residue on purpose: the delivered page may
// reuse their structure, never their sentences.
const DONOR_BODIES: Record<string, string> = {
  "donor-navbar": '<header data-sec="donor-navbar"><a href="#top">Lyceum</a><a href="#plan">Tutoring plan</a></header>',
  "donor-hero": '<header data-sec="donor-hero"><h1>Common Core and IB curriculum</h1><p>Python, JavaScript and cURL for teens</p><a href="#book">Book a tutoring plan</a></header>',
  "donor-features": '<section data-sec="donor-features"><h2>Lyceum gallery</h2><p>Python</p><p>JavaScript</p><p>cURL</p></section>',
  "donor-cta": '<section data-sec="donor-cta"><h2>IB curriculum activities</h2><a href="#c">Book a tutoring plan</a></section>',
  "donor-footer": '<footer data-sec="donor-footer"><p>Lyceum</p><a href="#ib">IB curriculum</a></footer>',
};

function donorRecord(id: string, type: string, rootTag: string, ordinal: number): SectionRecord {
  const html = DONOR_BODIES[id]!;
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 12);
  return {
    id, type, name: id, variantLabel: "Base", rootTag, mode: "light",
    storageKey: `sections/${id}-${hash}.html`, storageUrl: `memory://${id}`, contentHash: hash, size: html.length,
    designTokens: null, fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0",
      sourceTemplateId: `lyceum-${ordinal}`,
      sourceTemplateHash: hash,
      sourceBandOrdinal: ordinal,
      extractionVersion: "template-band-extractor/1.0",
      sourceHash: `sha256:${createHash("sha256").update(html).digest("hex")}`,
      structuralFingerprint: `sha256:${createHash("sha256").update(`${id}-fp`).digest("hex")}`,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0",
      role: type, layoutArchetypes: [], domains: [], audiences: [], moods: [], negativeSignals: [],
    },
    status: "published", createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  } as unknown as SectionRecord;
}

const DONOR_CATALOG = [
  donorRecord("donor-navbar", "navbar", "header", 0),
  donorRecord("donor-hero", "hero", "header", 1),
  donorRecord("donor-features", "features", "section", 2),
  donorRecord("donor-cta", "cta", "section", 3),
  donorRecord("donor-footer", "footer", "footer", 4),
];

// The kids-coloring niche is the origin of this regression; only its residue
// list is reused here, because its roles (coloring_gallery, minigames, …) are
// not composable from the catalog — that limit is covered in the route test.
const FORBIDDEN_RESIDUES = AI_HYBRID_NICHE_CASES[0]!.forbiddenResidues;
const BRIEF = "Necesito un sitio para mi taller de restauración de relojes mecánicos";

const PROFILE: BusinessProfileData = { business_name: "Mundo Pincel", brand: { accent: "#EC4899", logoUrl: null } } as BusinessProfileData;

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

  it("delivers a composition whose donors were Lyceum without keeping one donor sentence", async () => {
    const loadWholeTemplate = vi.fn(() => LEGACY_HTML);
    const deps = withForbiddenWholeTemplateLoader<RunAiCreationDeps>({
      listSections: vi.fn(async () => DONOR_CATALOG),
      fetchText: async (url: string) => DONOR_BODIES[url.replace("memory://", "")] ?? null,
      renderViewports: vi.fn(async () => ({
        desktop: { mimeType: "image/jpeg" as const, dataBase64: "" },
        mobile: { mimeType: "image/jpeg" as const, dataBase64: "" },
        mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false,
      })) as never,
      fableRuntimeOptions: {
        budgetConfig: { rateCardVersion: "test", mxnPerUsd: 20, targetMicromxn: 5_000_000, capMicromxn: 10_000_000 },
        telemetrySink: () => undefined,
      },
      // The creative provider is deliberately absent here; this regression is
      // about what the provider-free page is made of.
      creativeGenerationDeps: {
        runCreativeSession: async ({ baseline }) => ({ candidate: baseline, changed: false, acceptedMutations: 0, stoppedBy: "provider" as const }),
      },
    }, loadWholeTemplate);

    const result = await runAiCreation({
      projectId: "mundo-pincel",
      brief: BRIEF,
      profileData: PROFILE,
    }, deps);

    expect(loadWholeTemplate).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(`${result.stage}:${result.reasonCode}`);
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, filled: true });
    for (const residue of FORBIDDEN_RESIDUES) expect(result.html).not.toContain(residue);
    expect(result.html).not.toContain("Lyceum");
  });
});
