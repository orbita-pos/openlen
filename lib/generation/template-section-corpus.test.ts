import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  TemplateCorpusError,
  buildTemplateCorpus,
  redactTemplateCorpusManifest,
} from "./template-section-corpus";
import type { TemplateRecord } from "@/lib/templates/store";
import { TemplateVisualMetadataSchema } from "@/lib/templates/visual-metadata";

const sha12 = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

function template(index: number, overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  const id = `template-${String(index).padStart(3, "0")}`;
  const html = `<html><body><section>Template ${index}</section></body></html>`;
  const contentHash = sha12(html);
  return {
    id,
    name: `Template ${index}`,
    family: "saas",
    accent: "#000000",
    pitch: "Pitch",
    description: "Description",
    mode: "light",
    visualMetadata: null,
    storageKey: `templates/${id}-${contentHash}.html`,
    storageUrl: `https://templates.invalid/${id}-${contentHash}.html`,
    contentHash,
    size: Buffer.byteLength(html),
    pages: [],
    status: "published",
    thumbnailUrl: null,
    tileUrl: null,
    screenshotUrl: null,
    featured: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    publishedAt: new Date(0),
    ...overrides,
  };
}

function corpus(): TemplateRecord[] {
  return Array.from({ length: 450 }, (_, index) => template(index + 1));
}

function htmlFor(record: TemplateRecord): string {
  const index = Number(record.id.slice("template-".length));
  return `<html><body><section>Template ${index}</section></body></html>`;
}

describe("buildTemplateCorpus", () => {
  it("builds the exact deterministic 450-published-template authoritative corpus", async () => {
    const records = corpus().reverse();
    const fetchText = vi.fn(async (url: string) => {
      const record = records.find((row) => row.storageUrl === url);
      return record ? htmlFor(record) : null;
    });

    const result = await buildTemplateCorpus(records, { fetchText });

    expect(result.schemaVersion).toBe("template-section-corpus/1.0");
    expect(result.expectedCount).toBe(450);
    expect(result.rows).toHaveLength(450);
    expect(result.rows[0]?.templateId).toBe("template-001");
    expect(result.rows[449]?.templateId).toBe("template-450");
    expect(result.manifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fetchText).toHaveBeenCalledTimes(450);
  });

  it.each([
    ["template_corpus_count_mismatch", () => corpus().slice(0, 449)],
    ["template_corpus_duplicate", () => [...corpus().slice(0, 449), template(1)]],
    ["template_corpus_unpublished", () => corpus().map((row, index) => index === 0 ? { ...row, status: "draft" as const } : row)],
    ["template_corpus_invalid_record", () => corpus().map((row, index) => index === 0 ? { ...row, id: "../escape" } : row)],
    ["template_corpus_invalid_record", () => corpus().map((row, index) => index === 0 ? { ...row, storageKey: "templates/wrong.html" } : row)],
  ] as const)("rejects the whole corpus with %s", async (code, makeRows) => {
    await expect(buildTemplateCorpus(makeRows(), { fetchText: async (url) => {
      const record = makeRows().find((row) => row.storageUrl === url);
      return record ? htmlFor(record) : null;
    } })).rejects.toMatchObject({ code });
  });

  it("rejects missing and stale authoritative bytes without returning a partial corpus", async () => {
    const records = corpus();
    await expect(buildTemplateCorpus(records, {
      fetchText: async (url) => url === records[10]?.storageUrl ? null : htmlFor(records.find((row) => row.storageUrl === url)!),
    })).rejects.toMatchObject({ code: "template_corpus_unavailable" });

    await expect(buildTemplateCorpus(records, {
      fetchText: async (url) => url === records[10]?.storageUrl ? "<html>stale</html>" : htmlFor(records.find((row) => row.storageUrl === url)!),
    })).rejects.toMatchObject({ code: "template_corpus_stale" });
  });

  it("redacts HTML and storage URLs from the serializable report projection", async () => {
    const records = corpus();
    const manifest = await buildTemplateCorpus(records, {
      fetchText: async (url) => htmlFor(records.find((row) => row.storageUrl === url)!),
    });

    const report = redactTemplateCorpusManifest(manifest);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("https://");
    expect(report).toMatchObject({ expectedCount: 450, rowCount: 450, manifestHash: manifest.manifestHash });
  });

  it("changes the manifest when trusted visual classification changes without exposing it", async () => {
    const records = corpus();
    const fetchText = async (url: string) => htmlFor(records.find((row) => row.storageUrl === url)!);
    const baseline = await buildTemplateCorpus(records, { fetchText });
    const classified = records.map((record, index) => index === 0 ? {
      ...record,
      visualMetadata: TemplateVisualMetadataSchema.parse({
        schemaVersion: "template-visual-metadata/1.0",
        domains: ["children"],
        audiences: ["families"],
        ageRanges: ["5_10"],
        emotionalRegisters: ["playful"],
        visualArchetypes: ["illustrated"],
        visualSignals: ["coloring"],
        layoutTraits: ["editorial"],
        requiredAssetTypes: ["illustration"],
        negativeTags: ["dashboard"],
        supportedSiteTypes: ["creative_play"],
        supportedSectionRoles: ["hero"],
        themeability: "high",
        identityStrength: "high",
        reviewStatus: "reviewed",
      }),
    } : record);
    const changed = await buildTemplateCorpus(classified, {
      fetchText: async (url) => htmlFor(classified.find((row) => row.storageUrl === url)!),
    });

    expect(changed.manifestHash).not.toBe(baseline.manifestHash);
    expect(JSON.stringify(redactTemplateCorpusManifest(changed))).not.toContain("children");
  });

  it("exports a typed corpus error", () => {
    expect(new TemplateCorpusError("template_corpus_stale")).toMatchObject({
      name: "TemplateCorpusError",
      code: "template_corpus_stale",
    });
  });
});
