import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  prepareVisualMetadataRetry,
  runVisualMetadataSuggestionBatch,
  validateSuggestionArtifactSeed,
  validateReviewedMetadataInput,
  writeSuggestionArtifactAtomic,
  type SuggestionArtifactRow,
  type SuggestionArtifactProvenance,
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
  promptVersion: "template-visual-metadata-prompt/3.0",
  schemaVersion: "template-visual-metadata/1.0",
  generationConfig: {
    version: "template-visual-metadata-generation-config/3.0",
    temperature: 0.2,
    maxOutputTokens: 2_048,
    responseMimeType: "application/json",
    responseJsonSchemaVersion: "template-visual-metadata/1.0",
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

const HISTORICAL_AUDIT: SuggestionArtifactProvenance = {
  workflowVersion: "template-visual-metadata-suggestion-workflow/1.0",
  modelChoice: {
    version: "template-visual-metadata-model-choice/1.0",
    modelId: "gemini-2.5-flash",
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

const V2_AUDIT: SuggestionArtifactProvenance = {
  ...HISTORICAL_AUDIT,
  promptVersion: "template-visual-metadata-prompt/2.0",
  generationConfig: {
    version: "template-visual-metadata-generation-config/2.0",
    temperature: 0.2,
    maxOutputTokens: 2_048,
    responseMimeType: "application/json",
    responseJsonSchemaVersion: "template-visual-metadata/1.0",
    thinkingBudget: 0,
  },
};

type MutableProvenance = {
  workflowVersion?: unknown;
  modelChoice?: Record<string, unknown>;
  promptVersion?: unknown;
  schemaVersion?: unknown;
  generationConfig?: Record<string, unknown>;
  failurePolicy?: Record<string, unknown>;
  timeoutPolicy?: Record<string, unknown>;
};

function corruptHistoricalProvenance(change: (value: MutableProvenance) => void): unknown {
  const value = structuredClone(HISTORICAL_AUDIT) as unknown as MutableProvenance;
  change(value);
  return value;
}

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

function artifactRow(
  id: string,
  outcome: "suggested" | "failed",
  provenance: SuggestionArtifactRow["provenance"] = AUDIT,
): SuggestionArtifactRow {
  return {
    artifactVersion: "template-visual-metadata-suggestion-artifact/1.0",
    recordedAt: "2026-08-03T12:00:00.000Z",
    decision: {
      version: "template-visual-metadata-suggestion-decision/1.0",
      outcome,
    },
    id,
    name: `Template ${id}`,
    screenshotUrl: `https://example.test/${id}.jpg`,
    metadata: outcome === "suggested" ? UNREVIEWED_METADATA : null,
    error: outcome === "suggested" ? null : "parse: metadata schema rejected model output",
    provenance,
    evidence: { rawModelResponse: outcome === "suggested" ? "valid raw" : "invalid raw" },
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

describe("retry-failed suggestion artifacts", () => {
  it("validates complete seed coverage and selects only failed template IDs", () => {
    const successful = artifactRow("success", "suggested", HISTORICAL_AUDIT);
    const failed = artifactRow("failed", "failed", HISTORICAL_AUDIT);

    const retry = prepareVisualMetadataRetry(
      [template("success"), template("failed")],
      [successful, failed],
    );

    expect(retry.templates.map((row) => row.id)).toEqual(["failed"]);
    expect(retry.seedRows).toHaveLength(2);
    expect(retry.seedRows[0].provenance).toMatchObject({
      promptVersion: "template-visual-metadata-prompt/1.0",
      generationConfig: { version: "template-visual-metadata-generation-config/1.0" },
    });
  });

  it("accepts all three exact provenance generations without rewriting them", () => {
    for (const [id, provenance] of [
      ["v1", HISTORICAL_AUDIT],
      ["v2", V2_AUDIT],
      ["v3", AUDIT],
    ] as const) {
      const rows = validateSuggestionArtifactSeed(
        [artifactRow(id, "suggested", provenance)],
        new Set([id]),
      );
      expect(rows[0].provenance).toEqual(provenance);
    }
  });

  it("preserves existing v1 and v2 failure rows field-for-field", () => {
    const input = [
      artifactRow("v1-failure", "failed", HISTORICAL_AUDIT),
      artifactRow("v2-failure", "failed", V2_AUDIT),
    ];
    expect(validateSuggestionArtifactSeed(input, new Set(["v1-failure", "v2-failure"]))).toEqual(input);
  });

  it.each([
    ["template-visual-metadata-prompt/1.0", "template-visual-metadata-generation-config/1.0", true],
    ["template-visual-metadata-prompt/2.0", "template-visual-metadata-generation-config/2.0", true],
    ["template-visual-metadata-prompt/3.0", "template-visual-metadata-generation-config/3.0", true],
    ["template-visual-metadata-prompt/1.0", "template-visual-metadata-generation-config/2.0", false],
    ["template-visual-metadata-prompt/1.0", "template-visual-metadata-generation-config/3.0", false],
    ["template-visual-metadata-prompt/2.0", "template-visual-metadata-generation-config/1.0", false],
    ["template-visual-metadata-prompt/2.0", "template-visual-metadata-generation-config/3.0", false],
    ["template-visual-metadata-prompt/3.0", "template-visual-metadata-generation-config/1.0", false],
    ["template-visual-metadata-prompt/3.0", "template-visual-metadata-generation-config/2.0", false],
    ["template-visual-metadata-prompt/999", "template-visual-metadata-generation-config/1.0", false],
    ["template-visual-metadata-prompt/1.0", "template-visual-metadata-generation-config/999", false],
  ])("validates only the closed provenance pair %s + %s", (promptVersion, generationVersion, accepted) => {
    const generationConfig: Record<string, unknown> = {
      version: generationVersion,
      temperature: 0.2,
      maxOutputTokens: 2_048,
      responseMimeType: "application/json",
      thinkingBudget: 0,
    };
    if (generationVersion !== "template-visual-metadata-generation-config/1.0") {
      generationConfig.responseJsonSchemaVersion = "template-visual-metadata/1.0";
    }
    const provenance = {
      ...HISTORICAL_AUDIT,
      promptVersion,
      generationConfig,
    };
    const validate = () => validateSuggestionArtifactSeed(
      [artifactRow("a", "failed", provenance as unknown as SuggestionArtifactProvenance)],
      new Set(["a"]),
    );
    if (accepted) expect(validate()[0].provenance).toEqual(provenance);
    else expect(validate).toThrow("row 0: incomplete provenance");
  });

  it.each([
    ["missing workflow version", (value: MutableProvenance) => { delete value.workflowVersion; }],
    ["empty workflow version", (value: MutableProvenance) => { value.workflowVersion = ""; }],
    ["unknown workflow version", (value: MutableProvenance) => { value.workflowVersion = "workflow/999"; }],
    ["missing model choice", (value: MutableProvenance) => { delete value.modelChoice; }],
    ["empty model-choice version", (value: MutableProvenance) => { value.modelChoice!.version = ""; }],
    ["unknown model-choice version", (value: MutableProvenance) => { value.modelChoice!.version = "model-choice/999"; }],
    ["empty model ID", (value: MutableProvenance) => { value.modelChoice!.modelId = "  "; }],
    ["missing prompt version", (value: MutableProvenance) => { delete value.promptVersion; }],
    ["empty prompt version", (value: MutableProvenance) => { value.promptVersion = ""; }],
    ["unknown prompt version", (value: MutableProvenance) => { value.promptVersion = "prompt/999"; }],
    ["v2 prompt with v1 generation config", (value: MutableProvenance) => {
      value.promptVersion = "template-visual-metadata-prompt/2.0";
    }],
    ["v1 prompt with v2 generation config", (value: MutableProvenance) => {
      value.generationConfig!.version = "template-visual-metadata-generation-config/2.0";
      value.generationConfig!.responseJsonSchemaVersion = "template-visual-metadata/1.0";
    }],
    ["missing schema version", (value: MutableProvenance) => { delete value.schemaVersion; }],
    ["unknown schema version", (value: MutableProvenance) => { value.schemaVersion = "template-visual-metadata/999"; }],
    ["missing generation config", (value: MutableProvenance) => { delete value.generationConfig; }],
    ["empty generation-config version", (value: MutableProvenance) => { value.generationConfig!.version = ""; }],
    ["unknown generation-config version", (value: MutableProvenance) => { value.generationConfig!.version = "generation/999"; }],
    ["missing temperature", (value: MutableProvenance) => { delete value.generationConfig!.temperature; }],
    ["invalid temperature", (value: MutableProvenance) => { value.generationConfig!.temperature = -0.1; }],
    ["non-numeric temperature", (value: MutableProvenance) => { value.generationConfig!.temperature = "0.2"; }],
    ["invalid max output tokens", (value: MutableProvenance) => { value.generationConfig!.maxOutputTokens = 0; }],
    ["non-numeric max output tokens", (value: MutableProvenance) => { value.generationConfig!.maxOutputTokens = "2048"; }],
    ["invalid response MIME", (value: MutableProvenance) => { value.generationConfig!.responseMimeType = "text/plain"; }],
    ["invalid thinking budget", (value: MutableProvenance) => { value.generationConfig!.thinkingBudget = -1; }],
    ["missing v2 response schema version", (value: MutableProvenance) => {
      value.promptVersion = "template-visual-metadata-prompt/2.0";
      value.generationConfig!.version = "template-visual-metadata-generation-config/2.0";
    }],
    ["missing v3 response schema version", (value: MutableProvenance) => {
      value.promptVersion = "template-visual-metadata-prompt/3.0";
      value.generationConfig!.version = "template-visual-metadata-generation-config/3.0";
    }],
    ["missing failure policy", (value: MutableProvenance) => { delete value.failurePolicy; }],
    ["empty failure-policy version", (value: MutableProvenance) => { value.failurePolicy!.version = ""; }],
    ["invalid maximum failure rate", (value: MutableProvenance) => { value.failurePolicy!.maximumFailureRate = 0.2; }],
    ["non-numeric maximum failure rate", (value: MutableProvenance) => { value.failurePolicy!.maximumFailureRate = "0.1"; }],
    ["missing timeout policy", (value: MutableProvenance) => { delete value.timeoutPolicy; }],
    ["empty timeout-policy version", (value: MutableProvenance) => { value.timeoutPolicy!.version = ""; }],
    ["invalid timeout", (value: MutableProvenance) => { value.timeoutPolicy!.timeoutMs = 0; }],
    ["non-numeric timeout", (value: MutableProvenance) => { value.timeoutPolicy!.timeoutMs = "60000"; }],
  ] as Array<[string, (value: MutableProvenance) => void]>) (
    "rejects provenance with %s",
    (_label, mutate) => {
      const provenance = corruptHistoricalProvenance(mutate);
      expect(() => validateSuggestionArtifactSeed(
        [artifactRow("a", "failed", provenance as SuggestionArtifactRow["provenance"])],
        new Set(["a"]),
      )).toThrow("row 0: incomplete provenance");
    },
  );

  it("rejects duplicate, unknown, or incomplete seed IDs", () => {
    expect(() => validateSuggestionArtifactSeed(
      [artifactRow("a", "failed"), artifactRow("a", "failed")],
      new Set(["a"]),
    )).toThrow("row 1: duplicate template a");
    expect(() => validateSuggestionArtifactSeed(
      [artifactRow("unknown", "failed")],
      new Set(["a"]),
    )).toThrow("row 0: unknown published template unknown");
    expect(() => validateSuggestionArtifactSeed(
      [artifactRow("a", "failed")],
      new Set(["a", "b"]),
    )).toThrow("seed artifact does not cover published template b");
  });

  it("rejects decision/metadata mismatches and incomplete provenance", () => {
    const reviewedSuccess = {
      ...artifactRow("a", "suggested"),
      metadata: REVIEWED_METADATA,
    };
    expect(() => validateSuggestionArtifactSeed([reviewedSuccess], new Set(["a"])))
      .toThrow("row 0: a suggestion is not unreviewed");

    const failedWithMetadata = {
      ...artifactRow("a", "failed"),
      metadata: UNREVIEWED_METADATA,
    };
    expect(() => validateSuggestionArtifactSeed([failedWithMetadata], new Set(["a"])))
      .toThrow("row 0: a failed decision must have null metadata");

    const missingProvenance = {
      ...artifactRow("a", "failed"),
      provenance: { workflowVersion: "template-visual-metadata-suggestion-workflow/1.0" },
    };
    expect(() => validateSuggestionArtifactSeed([missingProvenance], new Set(["a"])))
      .toThrow("row 0: incomplete provenance");
  });

  it("merges retry results by ID, preserves successes, and checkpoints after every attempt", async () => {
    const preserved = artifactRow("preserved", "suggested");
    const seedRows = [preserved, artifactRow("retry-a", "failed"), artifactRow("retry-b", "failed")];
    const checkpoints: SuggestionArtifactRow[][] = [];
    const result = await runVisualMetadataSuggestionBatch(
      [template("retry-a"), template("retry-b")],
      {
        seedRows,
        suggest: async (record) => record.id === "retry-a" ? success("new valid raw") : failure("still invalid"),
        now: () => new Date("2026-08-03T13:00:00.000Z"),
        onCheckpoint: (rows) => {
          checkpoints.push(structuredClone(rows));
        },
      },
    );

    expect(result.attempted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual(["preserved", "retry-a", "retry-b"]);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(3);
    expect(result.rows[0]).toEqual(preserved);
    expect(result.rows[1]).toMatchObject({
      decision: { outcome: "suggested" },
      recordedAt: "2026-08-03T13:00:00.000Z",
      evidence: { rawModelResponse: "new valid raw" },
    });
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].map((row) => row.id)).toEqual(["preserved", "retry-a", "retry-b"]);
    expect(checkpoints[0].find((row) => row.id === "retry-b")?.decision.outcome).toBe("failed");
  });

  it("rejects duplicate seed rows even when the batch unit is called directly", async () => {
    await expect(runVisualMetadataSuggestionBatch([], {
      seedRows: [artifactRow("a", "failed"), artifactRow("a", "failed")],
    })).rejects.toThrow("duplicate seed template a");
  });

  it("writes and replaces an artifact through an atomic checkpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "openlen-metadata-review-"));
    const path = join(directory, "artifact.json");
    try {
      writeSuggestionArtifactAtomic(path, [artifactRow("a", "failed")]);
      expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(1);
      writeSuggestionArtifactAtomic(path, [artifactRow("a", "suggested"), artifactRow("b", "failed")]);
      const replaced = JSON.parse(readFileSync(path, "utf8"));
      expect(replaced.map((row: { id: string }) => row.id)).toEqual(["a", "b"]);
      expect(existsSync(`${path}.tmp`)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
