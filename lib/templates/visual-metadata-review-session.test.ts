import { describe, expect, it } from "vitest";
import type { SuggestionArtifactRow } from "./visual-metadata-review-workflow";
import type { TemplateVisualMetadata } from "./visual-metadata";
import {
  REVIEW_EVENT_VERSION,
  REVIEW_SESSION_VERSION,
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

    expect(session.version).toBe(REVIEW_SESSION_VERSION);
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
      .toEqual([[REVIEW_EVENT_VERSION, 1], [REVIEW_EVENT_VERSION, 2]]);
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
    const sourceRows = [row("one"), row("failed", "failed")];
    const session = create(sourceRows);
    const dto = buildSafeReviewDto(session, sourceRows);
    const serialized = JSON.stringify(dto);

    expect(dto.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "one", screenshotEndpoint: "https://images.example.test/one.jpg", state: "pending" }),
      expect.objectContaining({ id: "failed", failureKind: "parse", state: "failed", metadata: null }),
    ]));
    expect(serialized).not.toContain("RAW_EVIDENCE_MUST_NEVER_LEAK");
    expect(serialized).not.toContain("rawModelResponse");
    expect(serialized).not.toContain("ada@example.test");
    expect(serialized).not.toContain("provenance");
  });
});
