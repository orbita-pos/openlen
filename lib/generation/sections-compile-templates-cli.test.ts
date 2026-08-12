import { describe, expect, it, vi } from "vitest";

import {
  parseTemplateSectionCompilationArgs,
  runTemplateSectionCompilation,
} from "./sections-compile-templates-cli";
import type { CompileDerivedSectionResult } from "./derived-section-compiler";
import type { ExtractTemplateBandsResult } from "./template-section-extractor";

const HASH = `sha256:${"a".repeat(64)}`;
const row = (templateId: string) => ({
  templateId,
  templateContentHash: "a".repeat(12),
  storageKey: `templates/${templateId}-${"a".repeat(12)}.html`,
  storageUrl: `https://templates.invalid/${templateId}.html`,
  mode: "light" as const,
  visualMetadata: null,
  html: `<html><body><section id="hero">${templateId}</section></body></html>`,
});

function deps(events: string[] = []) {
  const section = (templateId: string) => ({
    id: `derived-hero-${templateId}-0-aaaaaaaaaaaa`,
    html: `<section>${templateId}</section>`,
    type: "hero" as const,
    mode: "light" as const,
    provenance: {
      schemaVersion: "derived-section-provenance/1.0" as const,
      sourceTemplateId: templateId,
      sourceTemplateHash: "a".repeat(12),
      sourceBandOrdinal: 0,
      extractionVersion: "template-band-extractor/1.0" as const,
      sourceHash: HASH,
      structuralFingerprint: `sha256:${(templateId === "arcana" ? "b" : "c").repeat(64)}`,
    },
    semantics: {
      schemaVersion: "derived-section-semantics/1.0" as const,
      role: "hero" as const,
      layoutArchetypes: ["editorial" as const],
      domains: ["children_creativity" as const],
      audiences: ["children" as const],
      moods: ["playful" as const],
      negativeSignals: [],
    },
    designTokens: {}, fonts: [], needsJs: false, hasPlaceholders: false,
    contentHash: templateId === "arcana" ? "b".repeat(12) : "c".repeat(12),
    renderScore: 90,
    sourceExactHash: templateId === "arcana" ? `sha256:${"d".repeat(64)}` : `sha256:${"e".repeat(64)}`,
  });
  return {
    loadCorpus: vi.fn(async () => ({ schemaVersion: "template-section-corpus/1.0" as const, expectedCount: 450 as const, manifestHash: HASH, rows: [row("arcana"), row("obra")] })),
    extract: vi.fn((source: ReturnType<typeof row>): ExtractTemplateBandsResult => ({ ok: true as const, bands: [{ templateId: source.templateId, templateContentHash: source.templateContentHash, ordinal: 0, rootTag: "section" as const, sourceHtml: source.html, sourceHash: HASH, sourceIds: ["hero"] }] })),
    compile: vi.fn(async (band: { templateId: string }): Promise<CompileDerivedSectionResult> => ({ ok: true as const, section: section(band.templateId) })),
    dedupe: vi.fn((sections: ReturnType<typeof section>[]) => ({ accepted: sections, duplicates: [] })),
    writeReportAtomic: vi.fn(async (_report: unknown) => { events.push("report"); }),
    publishCatalog: vi.fn(async (_sections: unknown, _report: unknown) => { events.push("publish"); }),
  };
}

describe("runTemplateSectionCompilation", () => {
  it("accepts exactly one mode and the fixed 450-published-template guard", () => {
    expect(parseTemplateSectionCompilationArgs(["--dry-run", "--expected-count=450"])).toBe("dry-run");
    expect(parseTemplateSectionCompilationArgs(["--publish", "--expected-count=450"])).toBe("publish");
    expect(() => parseTemplateSectionCompilationArgs(["--dry-run"])).toThrow("invalid_compile_mode");
    expect(() => parseTemplateSectionCompilationArgs(["--dry-run", "--publish", "--expected-count=450"])).toThrow("invalid_compile_mode");
    expect(() => parseTemplateSectionCompilationArgs(["--dry-run", "--expected-count=451"])).toThrow("invalid_compile_argument");
  });
  it("dry-run compiles every row and writes a redacted report with zero publication", async () => {
    const d = deps();
    const result = await runTemplateSectionCompilation({ mode: "dry-run" }, d);
    expect(result).toMatchObject({ ok: true, acceptedCount: 2 });
    expect(d.compile).toHaveBeenCalledTimes(2);
    expect(d.writeReportAtomic).toHaveBeenCalledTimes(1);
    expect(d.publishCatalog).not.toHaveBeenCalled();
    expect(JSON.stringify(d.writeReportAtomic.mock.calls[0]?.[0])).not.toContain("<section>");
  });

  it("writes the complete report before one atomic publication", async () => {
    const events: string[] = [];
    const d = deps(events);
    await runTemplateSectionCompilation({ mode: "publish" }, d);
    expect(events).toEqual(["report", "publish"]);
    expect(d.publishCatalog).toHaveBeenCalledTimes(1);
    expect(d.publishCatalog.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it.each(["corpus", "extract", "compile", "report"] as const)("publishes nothing when %s fails", async (stage) => {
    const d = deps();
    if (stage === "corpus") d.loadCorpus.mockRejectedValueOnce(new Error("fail"));
    if (stage === "extract") d.extract.mockReturnValueOnce({ ok: false as const, code: "invalid_template_document" });
    if (stage === "compile") d.compile.mockRejectedValueOnce(new Error("fail"));
    if (stage === "report") d.writeReportAtomic.mockRejectedValueOnce(new Error("fail"));
    await expect(runTemplateSectionCompilation({ mode: "publish" }, d)).rejects.toThrow();
    expect(d.publishCatalog).not.toHaveBeenCalled();
  });
});
