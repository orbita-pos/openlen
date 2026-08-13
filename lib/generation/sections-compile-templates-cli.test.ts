import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import {
  buildTemplateCorpusFromOrigin,
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
  it("builds the corpus from authoritative storage keys, never public URLs", async () => {
    const records = Array.from({ length: 450 }, (_, index) => {
      const id = `template-${String(index).padStart(3, "0")}`;
      const html = `<html><body><section>${id}</section></body></html>`;
      const contentHash = createHash("sha256").update(html).digest("hex").slice(0, 12);
      return ({
      id,
      name: id,
      family: "portfolio" as const,
      accent: "#000000",
      pitch: "pitch",
      description: "description",
      mode: "light" as const,
      visualMetadata: null,
      storageKey: `templates/${id}-${contentHash}.html`,
      storageUrl: `https://templates.invalid/${id}-${contentHash}.html`,
      contentHash,
      size: Buffer.byteLength(html),
      pages: [],
      status: "published" as const,
      thumbnailUrl: null,
      tileUrl: null,
      screenshotUrl: null,
      featured: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      publishedAt: new Date(0),
      html,
    });
    });
    const readObject = vi.fn(async (key: string) => {
      const record = records.find((candidate) => candidate.storageKey === key);
      return record?.html ?? null;
    });

    const manifest = await buildTemplateCorpusFromOrigin(records, readObject);

    expect(manifest.rows).toHaveLength(450);
    expect(readObject).toHaveBeenCalledTimes(450);
    expect(readObject).toHaveBeenCalledWith(records[0].storageKey);
    expect(readObject.mock.calls.flat().join(" ")).not.toContain("https://");
  });
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

  it("bounds compilation concurrency to two workers", async () => {
    const d = deps();
    d.loadCorpus.mockResolvedValueOnce({
      schemaVersion: "template-section-corpus/1.0",
      expectedCount: 450,
      manifestHash: HASH,
      rows: Array.from({ length: 6 }, (_, index) => row(`source-${index}`)),
    });
    let active = 0;
    let maximum = 0;
    d.compile.mockImplementation(async (band: { templateId: string }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: false as const, code: "render_failed" as const };
    });

    await runTemplateSectionCompilation({ mode: "dry-run" }, d);
    expect(maximum).toBe(2);
  });

  it("writes the complete report before one atomic publication", async () => {
    const events: string[] = [];
    const d = deps(events);
    await runTemplateSectionCompilation({ mode: "publish" }, d);
    expect(events).toEqual(["report", "publish"]);
    expect(d.publishCatalog).toHaveBeenCalledTimes(1);
    expect(d.publishCatalog.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("omits invalid source templates atomically and records a redacted rejection", async () => {
    const d = deps();
    d.extract.mockReturnValueOnce({ ok: false as const, code: "invalid_template_document" });

    const result = await runTemplateSectionCompilation({ mode: "publish" }, d);

    expect(result).toMatchObject({ ok: true, acceptedCount: 1, rejectedCount: 1 });
    expect(d.compile).toHaveBeenCalledTimes(1);
    expect(d.publishCatalog).toHaveBeenCalledTimes(1);
    expect(d.publishCatalog.mock.calls[0]?.[0]).toHaveLength(1);
    expect(result.report.rejectionCounts).toEqual({ invalid_fragment: 1 });
    expect(JSON.stringify(result.report)).not.toContain("invalid_template_document");
  });

  it.each(["corpus", "compile", "report"] as const)("publishes nothing when %s fails", async (stage) => {
    const d = deps();
    if (stage === "corpus") d.loadCorpus.mockRejectedValueOnce(new Error("fail"));
    if (stage === "compile") d.compile.mockRejectedValueOnce(new Error("fail"));
    if (stage === "report") d.writeReportAtomic.mockRejectedValueOnce(new Error("fail"));
    await expect(runTemplateSectionCompilation({ mode: "publish" }, d)).rejects.toThrow();
    expect(d.publishCatalog).not.toHaveBeenCalled();
  });
});
