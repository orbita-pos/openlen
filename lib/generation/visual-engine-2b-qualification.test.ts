import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionType } from "@/lib/sections/types";
import { qualifyVisualEngine2BCohort, verifyVisualEngine2BQualification } from "./visual-engine-2b-qualification";

function record(id: string, type: SectionType): SectionRecord {
  const html = `<section data-sec="${id}">${id}</section>`;
  const contentHash = createHash("sha256").update(html).digest("hex").slice(0, 12);
  const sha256 = `sha256:${createHash("sha256").update(`source:${id}`).digest("hex")}`;
  return { id, type, name: id, variantLabel: id, rootTag: "section", mode: "light", storageKey: `sections/${id}-${contentHash}.html`, storageUrl: `https://invalid/${id}`,
    contentHash, size: html.length, designTokens: null, fonts: null, needsJs: false,
    hasPlaceholders: false, thumbnailUrl: null, status: "published",
    provenance: { schemaVersion: "derived-section-provenance/1.0", sourceTemplateId: `donor-${id}`, sourceTemplateHash: contentHash, sourceBandOrdinal: 0, extractionVersion: "template-band-extractor/1.0", sourceHash: sha256, structuralFingerprint: sha256 },
    derivedSemantics: { schemaVersion: "derived-section-semantics/1.0", role: type, layoutArchetypes: [], domains: [], audiences: [], moods: [], negativeSignals: [] },
    createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0) };
}

const RECORDS = ["navbar", "hero", "gallery", "how-it-works", "integrations", "pricing", "faq", "about", "contact", "footer"]
  .flatMap((type) => Array.from({ length: type === "contact" || type === "gallery" ? 2 : 1 }, (_, index) => record(`${type}-${index + 1}`, type as SectionType)))
  .concat(Array.from({ length: 4 }, (_, index) => record(`features-${index + 1}`, "features")));

describe("qualifyVisualEngine2BCohort", () => {
  it("qualifies 13 compositions and 2 intentional typed fallbacks without provider capabilities", async () => {
    const result = await qualifyVisualEngine2BCohort({
      loadPublishedSections: async () => RECORDS,
      commitSha: async () => "a".repeat(40),
    });
    expect(result.ok, JSON.stringify(result.manifest.rows)).toBe(true);
    expect(result.manifest.counts).toEqual({ total: 15, qualified: 13, typedFallback: 2 });
    expect(result.manifest.rows).toHaveLength(15);
    expect(verifyVisualEngine2BQualification(result.manifest, { commitSha: "a".repeat(40), inventoryHash: result.manifest.inventoryHash })).toBe(true);
  });

  it("rejects stale or altered manifests", async () => {
    const result = await qualifyVisualEngine2BCohort({ loadPublishedSections: async () => RECORDS, commitSha: async () => "a".repeat(40) });
    expect(verifyVisualEngine2BQualification(result.manifest, { commitSha: "b".repeat(40), inventoryHash: result.manifest.inventoryHash })).toBe(false);
    expect(verifyVisualEngine2BQualification({ ...result.manifest, counts: { ...result.manifest.counts, qualified: 12 } }, { commitSha: "a".repeat(40), inventoryHash: result.manifest.inventoryHash })).toBe(false);
  });
});
