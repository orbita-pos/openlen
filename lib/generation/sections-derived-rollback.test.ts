import { describe, expect, it, vi } from "vitest";
import { parseDerivedRollbackReportPath, restoreDerivedSectionCatalog } from "../../scripts/sections-derived-rollback";
import { redactDerivedSectionCompilation } from "./derived-section-contracts";

const SHA = `sha256:${"a".repeat(64)}`;
function report() {
  const accepted = Array.from({ length: 3 }, (_, index) => ({
    id: `derived-hero-donor-${index}-aaaaaaaaaaaa`, contentHash: String(index).padStart(12, "0"), html: `<section>${index}</section>`,
    provenance: { schemaVersion: "derived-section-provenance/1.0" as const, sourceTemplateId: `donor-${index}`, sourceTemplateHash: "a".repeat(12), sourceBandOrdinal: index, extractionVersion: "template-band-extractor/1.0" as const, sourceHash: SHA, structuralFingerprint: `sha256:${String(index + 1).repeat(64)}` },
    semantics: { schemaVersion: "derived-section-semantics/1.0" as const, role: "hero" as const, layoutArchetypes: ["centered" as const], domains: ["children_creativity" as const], audiences: ["children" as const], moods: ["playful" as const], negativeSignals: [] },
  }));
  return redactDerivedSectionCompilation({ corpusManifestHash: SHA, catalogManifestHash: `sha256:${"b".repeat(64)}`, expectedTemplates: 451, processedTemplates: 451, accepted, rejected: [], duplicates: [] });
}

describe("derived section catalog rollback", () => {
  it("accepts only one canonical historical report below the fixed scratch directory", () => {
    const cwd = "C:/repo";
    expect(parseDerivedRollbackReportPath([`--report=scratch/visual-engine-derived-sections/history/${"a".repeat(64)}.json`], cwd)).toContain(`${"a".repeat(64)}.json`);
    for (const arg of ["", "--report=../secret.json", "--report=scratch/visual-engine-derived-sections/compilation-report.json", "--report=scratch/visual-engine-derived-sections/history/not-a-hash.json"]) expect(() => parseDerivedRollbackReportPath(arg ? [arg] : [], cwd)).toThrow();
  });
  it("restores the exact prior IDs and archives other derived rows in one SQL call", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rowCount: 3 }));
    await restoreDerivedSectionCatalog(report(), execute);
    expect(execute).toHaveBeenCalledTimes(1);
    const statement = JSON.stringify(execute.mock.calls[0][0]);
    expect(statement).toContain("WITH candidates AS");
    expect(statement).toContain("SELECT COUNT(*) FROM candidates");
    expect(statement).not.toMatch(/html|brief|prompt/i);
  });
});
