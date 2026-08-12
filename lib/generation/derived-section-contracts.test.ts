import { describe, expect, it } from "vitest";

import {
  DerivedSectionProvenanceSchema,
  DerivedSectionSemanticsSchema,
  DerivedSectionCompilationReportSchema,
  redactDerivedSectionCompilation,
} from "./derived-section-contracts";

const HASH = `sha256:${"a".repeat(64)}`;

const PROVENANCE = DerivedSectionProvenanceSchema.parse({
  schemaVersion: "derived-section-provenance/1.0",
  sourceTemplateId: "arcana",
  sourceTemplateHash: "a".repeat(12),
  sourceBandOrdinal: 2,
  extractionVersion: "template-band-extractor/1.0",
  sourceHash: HASH,
  structuralFingerprint: `sha256:${"b".repeat(64)}`,
});

const SEMANTICS = DerivedSectionSemanticsSchema.parse({
  schemaVersion: "derived-section-semantics/1.0",
  role: "hero",
  layoutArchetypes: ["editorial", "media_split"],
  domains: ["children_creativity"],
  audiences: ["children", "families"],
  moods: ["playful", "warm"],
  negativeSignals: ["dashboard", "course_ui"],
});

describe("derived section contracts", () => {
  it("strictly accepts complete bounded provenance", () => {
    expect(DerivedSectionProvenanceSchema.parse(PROVENANCE)).toEqual(PROVENANCE);
    for (const invalid of [
      { ...PROVENANCE, html: "<section>private</section>" },
      { ...PROVENANCE, sourceTemplateId: "../arcana" },
      { ...PROVENANCE, sourceTemplateHash: "short" },
      { ...PROVENANCE, sourceBandOrdinal: 128 },
      { ...PROVENANCE, extractionVersion: "future/2.0" },
      { ...PROVENANCE, sourceHash: "a".repeat(64) },
    ]) expect(DerivedSectionProvenanceSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts only the closed semantic vocabulary", () => {
    expect(DerivedSectionSemanticsSchema.parse(SEMANTICS)).toEqual(SEMANTICS);
    for (const invalid of [
      { ...SEMANTICS, prompt: "private brief" },
      { ...SEMANTICS, role: "unknown-role" },
      { ...SEMANTICS, domains: ["whatever-the-model-said"] },
      { ...SEMANTICS, moods: Array.from({ length: 9 }, () => "playful") },
      { ...SEMANTICS, negativeSignals: ["not-a-closed-signal"] },
    ]) expect(DerivedSectionSemanticsSchema.safeParse(invalid).success).toBe(false);
  });

  it("redacts compilation rows to counts, IDs, hashes, coverage, and reason codes", () => {
    const report = redactDerivedSectionCompilation({
      corpusManifestHash: HASH,
      catalogManifestHash: `sha256:${"c".repeat(64)}`,
      expectedTemplates: 450,
      processedTemplates: 450,
      accepted: [{
        id: "derived-hero-arcana-2-aaaaaaaaaaaa",
        contentHash: "a".repeat(12),
        provenance: PROVENANCE,
        semantics: SEMANTICS,
        html: "<section>Secret inherited copy</section>",
        storageUrl: "https://private.invalid/fragment",
      }],
      rejected: [{ templateId: "abismo", ordinal: 3, code: "unsafe_script", detail: "secret body" }],
      duplicates: [{ rejectedId: "derived-hero-copy", representativeId: "derived-hero-arcana-2-aaaaaaaaaaaa", reason: "structural" }],
    });
    const serialized = JSON.stringify(report);
    expect(() => DerivedSectionCompilationReportSchema.parse(report)).not.toThrow();
    expect(report).toMatchObject({
      expectedTemplates: 450,
      processedTemplates: 450,
      acceptedCount: 1,
      rejectedCount: 1,
      duplicateCount: 1,
      rejectionCounts: { unsafe_script: 1 },
    });
    expect(serialized).not.toContain("Secret inherited copy");
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("secret body");
  });

  it("rejects unsafe numeric and unknown report fields", () => {
    const valid = {
      schemaVersion: "derived-section-compilation-report/1.0",
      corpusManifestHash: HASH,
      catalogManifestHash: HASH,
      expectedTemplates: 450,
      processedTemplates: 450,
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      rejectionCounts: {},
      coverage: [],
      accepted: [],
      duplicates: [],
    };
    expect(DerivedSectionCompilationReportSchema.safeParse({ ...valid, acceptedCount: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(DerivedSectionCompilationReportSchema.safeParse({ ...valid, rawHtml: "<html>" }).success).toBe(false);
  });
});
