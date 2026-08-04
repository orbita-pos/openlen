import { describe, expect, it } from "vitest";
import type { SuggestionArtifactRow } from "./visual-metadata-review-workflow";
import type { TemplateVisualMetadata } from "./visual-metadata";
import {
  ReviewEventV1Schema,
  ReviewSessionV1Schema,
  applyReviewCommand,
  buildReviewExports,
  buildSafeReviewDto,
  createReviewSession,
  deriveReviewState,
  requiredApprovalCount,
} from "./visual-metadata-review-session";

const METADATA: TemplateVisualMetadata = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["saas"],
  audiences: ["businesses"],
  ageRanges: [],
  emotionalRegisters: ["technical"],
  visualArchetypes: ["technical_minimal"],
  visualSignals: ["saas_dashboard"],
  layoutTraits: ["dense"],
  requiredAssetTypes: ["product_mockup"],
  negativeTags: ["children"],
  supportedSiteTypes: ["product_landing"],
  supportedSectionRoles: ["hero", "features", "footer"],
  themeability: "medium",
  identityStrength: "high",
  reviewStatus: "unreviewed",
};

function row(id: string, outcome: "suggested" | "failed" = "suggested"): SuggestionArtifactRow {
  return {
    artifactVersion: "template-visual-metadata-suggestion-artifact/1.0",
    recordedAt: "2026-08-03T12:00:00.000Z",
    decision: {
      version: "template-visual-metadata-suggestion-decision/1.0",
      outcome,
    },
    id,
    name: `Template ${id}`,
    screenshotUrl: `https://images.example.test/${id}.jpg`,
    metadata: outcome === "suggested" ? { ...METADATA } : null,
    error: outcome === "failed" ? "parse: malformed metadata" : null,
    provenance: {
      workflowVersion: "template-visual-metadata-suggestion-workflow/1.0",
      modelChoice: { version: "template-visual-metadata-model-choice/1.0", modelId: "model" },
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
      failurePolicy: { version: "template-visual-metadata-failure-policy/1.0", maximumFailureRate: 0.1 },
      timeoutPolicy: { version: "template-visual-metadata-timeout-policy/1.0", timeoutMs: 60_000 },
    },
    evidence: { rawModelResponse: "RAW_EVIDENCE_MUST_NEVER_LEAK" },
  };
}

function create(rows: SuggestionArtifactRow[]) {
  return createReviewSession({
    sourceSha256: "a".repeat(64),
    rows,
    reviewer: { name: "Ada Reviewer", email: "ada@example.test" },
    now: new Date("2026-08-03T12:00:00.000Z"),
  });
}

function deps() {
  let event = 0;
  return {
    now: () => new Date("2026-08-03T12:00:01.000Z"),
    eventId: () => `event-${++event}`,
  };
}

describe("visual metadata review session domain", () => {
  it("creates a v1 session without copying raw evidence", () => {
    const sourceRows = [row("one")];
    const session = create(sourceRows);

    expect(session.version).toBe("template-visual-metadata-review-session/1.0");
    expect(JSON.stringify(session)).not.toContain("RAW_EVIDENCE_MUST_NEVER_LEAK");
    expect(JSON.stringify(session)).not.toContain("rawModelResponse");
  });

  it("emits contiguous sequences and deterministic derived state", () => {
    const sourceRows = [row("one")];
    const initial = create(sourceRows);
    const withEdit = applyReviewCommand(initial, sourceRows, {
      action: "metadata_updated", templateId: "one", field: "domains", value: ["developer_tools"],
    }, deps());
    const session = applyReviewCommand(withEdit, sourceRows, { action: "approved", templateId: "one" }, deps());

    expect(session.events.map((event) => [event.version, event.sequence]))
      .toEqual([["template-visual-metadata-review-event/1.0", 1], ["template-visual-metadata-review-event/1.0", 2]]);
    expect(deriveReviewState(session, sourceRows)).toEqual(deriveReviewState(session, structuredClone(sourceRows)));
    expect(deriveReviewState(session, sourceRows).items["one"]).toMatchObject({
      state: "approved",
      metadata: { domains: ["developer_tools"], reviewStatus: "reviewed" },
    });
  });

  it("validates lowercase snake_case arrays through the authoritative metadata schema", () => {
    const sourceRows = [row("one")];
    expect(() => applyReviewCommand(create(sourceRows), sourceRows, {
      action: "metadata_updated", templateId: "one", field: "domains", value: ["Not Valid"],
    }, deps())).toThrow();
  });

  it("sets reviewed only inside an approved server-side transition", () => {
    const sourceRows = [row("one")];
    const session = applyReviewCommand(create(sourceRows), sourceRows, {
      action: "metadata_updated", templateId: "one", field: "themeability", value: "high",
    }, deps());

    expect(deriveReviewState(session, sourceRows).items["one"].metadata?.reviewStatus).toBe("unreviewed");
    expect(() => applyReviewCommand(session, sourceRows, {
      action: "metadata_updated", templateId: "one", field: "reviewStatus" as never, value: "reviewed",
    }, deps())).toThrow();
    const approved = applyReviewCommand(session, sourceRows, { action: "approved", templateId: "one" }, deps());
    expect(deriveReviewState(approved, sourceRows).items["one"].metadata?.reviewStatus).toBe("reviewed");
  });

  it("rejects approval of failed rows", () => {
    const sourceRows = [row("failed", "failed")];
    expect(() => applyReviewCommand(create(sourceRows), sourceRows, {
      action: "approved", templateId: "failed",
    }, deps())).toThrow("cannot approve failed suggestion");
  });

  it("requires a trimmed non-empty rejection reason of at most 500 code points", () => {
    const sourceRows = [row("one")];
    for (const reason of ["   ", "a".repeat(501), "😀".repeat(501)]) {
      expect(() => applyReviewCommand(create(sourceRows), sourceRows, {
        action: "rejected", templateId: "one", reason,
      }, deps())).toThrow();
    }
    const rejected = applyReviewCommand(create(sourceRows), sourceRows, {
      action: "rejected", templateId: "one", reason: "  Not a match  ",
    }, deps());
    expect(deriveReviewState(rejected, sourceRows).items["one"]).toMatchObject({
      state: "rejected", rejectionReason: "Not a match",
    });
    const emoji = String.fromCodePoint(0x1f600);
    const fiveHundredEmoji = applyReviewCommand(create(sourceRows), sourceRows, {
      action: "rejected", templateId: "one", reason: emoji.repeat(500),
    }, deps());
    expect(deriveReviewState(fiveHundredEmoji, sourceRows).items["one"].rejectionReason).toBe(emoji.repeat(500));
  });

  it("reopens an approval without erasing history", () => {
    const sourceRows = [row("one")];
    const approved = applyReviewCommand(create(sourceRows), sourceRows, { action: "approved", templateId: "one" }, deps());
    const reopened = applyReviewCommand(approved, sourceRows, { action: "reopened", templateId: "one" }, deps());

    expect(reopened.events).toHaveLength(2);
    expect(reopened.events.map((event) => event.action)).toEqual(["approved", "reopened"]);
    expect(deriveReviewState(reopened, sourceRows).items["one"].state).toBe("pending");
  });

  it.each([[450, 428], [100, 95], [3, 3], [0, 0]])("computes ceil 95 percent for %i as %i", (total, expected) => {
    expect(requiredApprovalCount(total)).toBe(expected);
  });

  it("blocks final export while one suggestion is pending", () => {
    const sourceRows = [row("approved"), row("pending")];
    const session = applyReviewCommand(create(sourceRows), sourceRows, { action: "approved", templateId: "approved" }, deps());

    expect(deriveReviewState(session, sourceRows).progress.finalExportEnabled).toBe(false);
    expect(() => buildReviewExports(session, sourceRows)).toThrow("final export is not enabled");
  });

  it("blocks final export at 427 of 450 and enables it at 428 of 450", () => {
    const sourceRows = Array.from({ length: 450 }, (_, index) => row(String(index)));
    const reviewDeps = deps();
    let session = create(sourceRows);
    for (let index = 0; index < 427; index++) {
      session = applyReviewCommand(session, sourceRows, { action: "approved", templateId: String(index) }, reviewDeps);
    }
    for (let index = 427; index < 450; index++) {
      session = applyReviewCommand(session, sourceRows, { action: "rejected", templateId: String(index), reason: "Out of scope" }, reviewDeps);
    }
    expect(deriveReviewState(session, sourceRows).progress.finalExportEnabled).toBe(false);
    session = applyReviewCommand(session, sourceRows, { action: "reopened", templateId: "427" }, reviewDeps);
    session = applyReviewCommand(session, sourceRows, { action: "approved", templateId: "427" }, reviewDeps);
    expect(deriveReviewState(session, sourceRows).progress.finalExportEnabled).toBe(true);
    expect(buildReviewExports(session, sourceRows).reviewed).toHaveLength(428);
  });

  it("builds a safe DTO field by field without evidence, raw values, emails, or paths", () => {
    const sourceRows = [row("../one"), row("failed", "failed")];
    sourceRows[0].screenshotUrl = "file:///C:/private/raw-image.png";
    sourceRows[1].error = "private local artifact without a failure category";
    const session = create(sourceRows);
    const dto = buildSafeReviewDto(session, sourceRows);
    const serialized = JSON.stringify(dto);

    expect(dto.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "../one", screenshotEndpoint: "/api/internal/template-review/screenshots/%2E%2E%2Fone", state: "pending",
      }),
      expect.objectContaining({ id: "failed", failureKind: "unknown", state: "failed", metadata: null }),
    ]));
    expect(serialized).not.toContain("RAW_EVIDENCE_MUST_NEVER_LEAK");
    expect(serialized).not.toContain("rawModelResponse");
    expect(serialized).not.toContain("ada@example.test");
    expect(serialized).not.toContain("provenance");
    expect(serialized).not.toContain("file:///C:/private/raw-image.png");
    expect(serialized).not.toContain("private local artifact without a failure category");
  });

  it("uses all 450 source rows for the gate when 10 source rows failed", () => {
    const sourceRows = [
      ...Array.from({ length: 440 }, (_, index) => row(`suggested-${index}`)),
      ...Array.from({ length: 10 }, (_, index) => row(`failed-${index}`, "failed")),
    ];
    const reviewDeps = deps();
    let session = create(sourceRows);
    for (let index = 0; index < 427; index++) {
      session = applyReviewCommand(session, sourceRows, { action: "approved", templateId: `suggested-${index}` }, reviewDeps);
    }
    for (let index = 427; index < 440; index++) {
      session = applyReviewCommand(session, sourceRows, {
        action: "rejected", templateId: `suggested-${index}`, reason: "Out of scope",
      }, reviewDeps);
    }

    expect(deriveReviewState(session, sourceRows).progress).toMatchObject({
      total: 450, suggested: 440, failed: 10, pending: 0, requiredApprovals: 428, finalExportEnabled: false,
    });
    expect(() => buildReviewExports(session, sourceRows)).toThrow("final export is not enabled");
    session = applyReviewCommand(session, sourceRows, { action: "reopened", templateId: "suggested-427" }, reviewDeps);
    session = applyReviewCommand(session, sourceRows, { action: "approved", templateId: "suggested-427" }, reviewDeps);
    expect(deriveReviewState(session, sourceRows).progress.finalExportEnabled).toBe(true);
    expect(buildReviewExports(session, sourceRows).reviewed).toHaveLength(428);
  });

  it("uses a closed allowlist for failed-row categories", () => {
    const sourceRows = [row("parse", "failed"), row("unknown", "failed")];
    sourceRows[0].error = "parse: expected metadata";
    sourceRows[1].error = "file:///C:/private/raw.json";
    const dto = buildSafeReviewDto(create(sourceRows), sourceRows);

    expect(dto.items.map((item) => item.failureKind)).toEqual(["parse", "unknown"]);
  });

  it("rejects replay when an approved snapshot differs from the current draft", () => {
    const sourceRows = [row("one")];
    const approved = applyReviewCommand(create(sourceRows), sourceRows, { action: "approved", templateId: "one" }, deps());
    const tampered = structuredClone(approved) as unknown as { events: Array<Record<string, unknown>> };
    tampered.events[0].metadata = { ...METADATA, themeability: "low", reviewStatus: "reviewed" };

    expect(() => deriveReviewState(tampered as never, sourceRows)).toThrow("approved event metadata does not match draft");
    expect(() => buildReviewExports(tampered as never, sourceRows)).toThrow("approved event metadata does not match draft");
  });

  it("rejects strict schema violations for source versions, event snapshots, and rejection reasons", () => {
    const session = create([row("one")]);
    const unsupportedSource = structuredClone(session) as unknown as { source: { artifactVersion: string } };
    unsupportedSource.source.artifactVersion = "template-visual-metadata-suggestion-artifact/999";
    expect(ReviewSessionV1Schema.safeParse(unsupportedSource).success).toBe(false);

    const approvedEvent = {
      version: "template-visual-metadata-review-event/1.0",
      id: "event-1",
      sequence: 1,
      at: "2026-08-03T12:00:01.000Z",
      templateId: "one",
      action: "approved",
      metadata: { ...METADATA, reviewStatus: "reviewed", unexpected: true },
    };
    expect(ReviewEventV1Schema.safeParse(approvedEvent).success).toBe(false);
    expect(ReviewEventV1Schema.safeParse({
      version: "template-visual-metadata-review-event/1.0",
      id: "event-2",
      sequence: 2,
      at: "2026-08-03T12:00:01.000Z",
      templateId: "one",
      action: "rejected",
      reason: "   ",
    }).success).toBe(false);
  });

  it("rejects gaps and reordered review event sequences", () => {
    const sourceRows = [row("one"), row("two")];
    const reviewDeps = deps();
    const first = applyReviewCommand(create(sourceRows), sourceRows, { action: "approved", templateId: "one" }, reviewDeps);
    const twoEvents = applyReviewCommand(first, sourceRows, { action: "approved", templateId: "two" }, reviewDeps);
    const gap = structuredClone(twoEvents);
    gap.events[1].sequence = 3;
    const reordered = structuredClone(twoEvents);
    reordered.events.reverse();

    expect(() => deriveReviewState(gap, sourceRows)).toThrow("review events must have contiguous sequences");
    expect(() => deriveReviewState(reordered, sourceRows)).toThrow("review events must have contiguous sequences");
  });

  it("keeps audit and reviewed exports free of source evidence, raw values, emails, provenance, and paths", () => {
    const sourceRows = [row("one")];
    sourceRows[0].screenshotUrl = "file:///C:/private/raw-image.png";
    sourceRows[0].evidence.rawModelResponse = "raw local evidence";
    const session = applyReviewCommand(create(sourceRows), sourceRows, { action: "approved", templateId: "one" }, deps());
    const exported = buildReviewExports(session, sourceRows);
    const serialized = JSON.stringify(exported);

    for (const forbidden of ["raw local evidence", "rawModelResponse", "ada@example.test", "provenance", "file:///C:/private/raw-image.png"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
