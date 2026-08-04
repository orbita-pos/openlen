import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { TemplateRecord } from "./store";
import type {
  SuggestVisualMetadataAudit,
  SuggestVisualMetadataResult,
} from "./suggest-visual-metadata";
import type { TemplateVisualMetadata } from "./visual-metadata";
import {
  executeReviewedMetadataUpdate,
  runVisualMetadataSuggestionBatch,
  validateReviewedMetadataInput,
} from "./visual-metadata-review-workflow";

const REVIEWED_METADATA: TemplateVisualMetadata = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["saas"], audiences: ["businesses"], ageRanges: [],
  emotionalRegisters: ["technical"], visualArchetypes: ["technical_minimal"],
  visualSignals: ["saas_dashboard"], layoutTraits: ["dense"],
  requiredAssetTypes: ["product_mockup"], negativeTags: ["children"],
  supportedSiteTypes: ["product_landing"], supportedSectionRoles: ["hero", "features", "footer"],
  themeability: "medium", identityStrength: "high", reviewStatus: "reviewed",
};

const UNREVIEWED_METADATA: TemplateVisualMetadata = { ...REVIEWED_METADATA, reviewStatus: "unreviewed" };

const AUDIT: SuggestVisualMetadataAudit = {
  workflowVersion: "template-visual-metadata-suggestion-workflow/1.0",
  modelChoice: {
    version: "template-visual-metadata-model-choice/1.0",
    modelId: "gemini-test-model",
  },
  promptVersion: "template-visual-metadata-prompt/1.0",
  schemaVersion: "template-visual-metadata/1.0",
  generationConfig: {
    version: "template-visual-metadata-generation-config/1.0",
    temperature: 0.2,
    maxOutputTokens: 2_048,
    responseMimeType: "application/json",
    thinkingBudget: 0,
  },
  failurePolicy: {
    version: "template-visual-metadata-failure-policy/1.0",
    maximumFailureRate: 0.10,
  },
  timeoutPolicy: {
    version: "template-visual-metadata-timeout-policy/1.0",
    timeoutMs: 60_000,
  },
};

function template(id: string, reviewStatus: "reviewed" | "unreviewed" | null = null): TemplateRecord {
  return {
    id,
    name: `Template ${id}`,
    screenshotUrl: `https://example.test/${id}.jpg`,
    visualMetadata: reviewStatus ? { ...REVIEWED_METADATA, reviewStatus } : null,
  } as TemplateRecord;
}

function success(raw = "raw model json"): SuggestVisualMetadataResult {
  return { ok: true, metadata: UNREVIEWED_METADATA, raw, audit: AUDIT };
}

function failure(raw?: string): SuggestVisualMetadataResult {
  return {
    ok: false,
    kind: "parse",
    message: "malformed metadata JSON",
    ...(raw === undefined ? {} : { raw }),
    audit: AUDIT,
  };
}

describe("runVisualMetadataSuggestionBatch", () => {
  it("skips reviewed templates and records a versioned suggested artifact row", async () => {
    const attemptedIds: string[] = [];
    const timeouts: number[] = [];
    const suggest = vi.fn(async (record: TemplateRecord, options: { timeoutMs?: number }) => {
      attemptedIds.push(record.id);
      timeouts.push(options.timeoutMs ?? 0);
      return success();
    });

    const result = await runVisualMetadataSuggestionBatch(
      [template("reviewed", "reviewed"), template("missing")],
      { suggest, now: () => new Date("2026-08-03T12:00:00.000Z") },
    );

    expect(attemptedIds).toEqual(["missing"]);
    expect(timeouts).toEqual([60_000]);
    expect(result).toEqual({
      attempted: 1,
      failed: 0,
      shouldFail: false,
      rows: [{
        artifactVersion: "template-visual-metadata-suggestion-artifact/1.0",
        recordedAt: "2026-08-03T12:00:00.000Z",
        decision: {
          version: "template-visual-metadata-suggestion-decision/1.0",
          outcome: "suggested",
        },
        id: "missing",
        name: "Template missing",
        screenshotUrl: "https://example.test/missing.jpg",
        metadata: UNREVIEWED_METADATA,
        error: null,
        provenance: AUDIT,
        evidence: { rawModelResponse: "raw model json" },
      }],
    });
  });

  it("includes reviewed templates only when force is enabled", async () => {
    const attemptedIds: string[] = [];
    await runVisualMetadataSuggestionBatch([template("reviewed", "reviewed")], {
      force: true,
      suggest: async (record) => {
        attemptedIds.push(record.id);
        return success();
      },
    });
    expect(attemptedIds).toEqual(["reviewed"]);
  });

  it.each([
    { attempted: 10, shouldFail: false },
    { attempted: 9, shouldFail: true },
  ])("applies the versioned 10% failure threshold to $attempted attempts", async ({ attempted, shouldFail }) => {
    const templates = Array.from({ length: attempted }, (_, index) => template(String(index)));
    const result = await runVisualMetadataSuggestionBatch(templates, {
      suggest: async (record) => record.id === "0" ? failure("bad model output") : success(),
    });
    expect(result.failed).toBe(1);
    expect(result.shouldFail).toBe(shouldFail);
    expect(result.rows[0]).toMatchObject({
      decision: {
        version: "template-visual-metadata-suggestion-decision/1.0",
        outcome: "failed",
      },
      metadata: null,
      error: "parse: malformed metadata JSON",
      evidence: { rawModelResponse: "bad model output" },
      provenance: { failurePolicy: AUDIT.failurePolicy },
    });
  });
});

describe("validateReviewedMetadataInput", () => {
  it("rejects a non-array input", () => {
    expect(() => validateReviewedMetadataInput({}, new Set(["mirror"]))).toThrow("input must be an array");
  });

  it("rejects malformed metadata", () => {
    expect(() => validateReviewedMetadataInput(
      [{ id: "mirror", metadata: { reviewStatus: "reviewed" } }],
      new Set(["mirror"]),
    )).toThrow();
  });

  it.each(["unreviewed", "rejected"] as const)("rejects %s metadata", (reviewStatus) => {
    expect(() => validateReviewedMetadataInput(
      [{ id: "mirror", metadata: { ...REVIEWED_METADATA, reviewStatus } }],
      new Set(["mirror"]),
    )).toThrow(`row 0: mirror is not reviewed`);
  });

  it("rejects duplicate template IDs", () => {
    expect(() => validateReviewedMetadataInput([
      { id: "mirror", metadata: REVIEWED_METADATA },
      { id: "mirror", metadata: REVIEWED_METADATA },
    ], new Set(["mirror"]))).toThrow("row 1: duplicate template mirror");
  });

  it("rejects unknown published template IDs", () => {
    expect(() => validateReviewedMetadataInput(
      [{ id: "unknown", metadata: REVIEWED_METADATA }],
      new Set(["mirror"]),
    )).toThrow("row 0: unknown published template unknown");
  });
});

describe("executeReviewedMetadataUpdate", () => {
  it("executes one set-based SQL update for every validated row", async () => {
    const rows = validateReviewedMetadataInput([
      { id: "mirror", metadata: REVIEWED_METADATA },
      { id: "prism", metadata: REVIEWED_METADATA },
    ], new Set(["mirror", "prism"]));
    const queries: Parameters<Parameters<typeof executeReviewedMetadataUpdate>[1]>[0][] = [];

    await executeReviewedMetadataUpdate(rows, async (query) => {
      queries.push(query);
      return undefined;
    });

    expect(queries).toHaveLength(1);
    const compiled = new PgDialect().sqlToQuery(queries[0]);
    expect(compiled.sql).toContain('UPDATE "templates" AS target');
    expect(compiled.sql).toContain("FROM (VALUES");
    expect(compiled.params).toHaveLength(4);
    expect(compiled.params).toContain("mirror");
    expect(compiled.params).toContain("prism");
  });

  it("does not execute an update for an empty reviewed input", async () => {
    const execute = vi.fn();
    await executeReviewedMetadataUpdate([], execute);
    expect(execute).not.toHaveBeenCalled();
  });
});
