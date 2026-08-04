import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VISUAL_METADATA_ARTIFACT_VERSION, VISUAL_METADATA_DECISION_VERSION } from "./visual-metadata-suggestion-contract";
import {
  loadVisualMetadataReviewSource,
  openVisualMetadataReviewWorkspace,
  type ReviewWorkspaceDependencies,
} from "./visual-metadata-review-session-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openlen-review-store-"));
  directories.push(directory);
  return directory;
}

function row(id: string, outcome: "suggested" | "failed" = "suggested") {
  return {
    artifactVersion: VISUAL_METADATA_ARTIFACT_VERSION,
    recordedAt: "2026-08-04T00:00:00.000Z",
    decision: { version: VISUAL_METADATA_DECISION_VERSION, outcome },
    id,
    name: `Template ${id}`,
    screenshotUrl: null,
    metadata: outcome === "suggested" ? {
      schemaVersion: "template-visual-metadata/1.0",
      domains: ["developer_tools"], audiences: ["developers"], ageRanges: [], emotionalRegisters: [],
      visualArchetypes: [], visualSignals: [], layoutTraits: [], requiredAssetTypes: [], negativeTags: [],
      supportedSiteTypes: ["saas"], supportedSectionRoles: ["hero"], themeability: "high",
      identityStrength: "high", reviewStatus: "unreviewed",
    } : null,
    error: outcome === "failed" ? "timeout: request timed out" : null,
    provenance: {
      workflowVersion: "template-visual-metadata-suggestion-workflow/1.0",
      modelChoice: { version: "template-visual-metadata-model-choice/1.0", modelId: "review-test" },
      promptVersion: "template-visual-metadata-prompt/3.0",
      schemaVersion: "template-visual-metadata/1.0",
      generationConfig: {
        version: "template-visual-metadata-generation-config/3.0", temperature: 0.2, maxOutputTokens: 2048,
        responseMimeType: "application/json", responseJsonSchemaVersion: "template-visual-metadata/1.0", thinkingBudget: 0,
      },
      failurePolicy: { version: "template-visual-metadata-failure-policy/1.0", maximumFailureRate: 0.1 },
      timeoutPolicy: { version: "template-visual-metadata-timeout-policy/1.0", timeoutMs: 60_000 },
    },
    evidence: { rawModelResponse: "SOURCE_BYTES_MUST_REMAIN_PRIVATE" },
  };
}

async function fixture(rows = [row("one")]) {
  const directory = await temporaryDirectory();
  const inputPath = join(directory, "suggestions.json");
  await writeFile(inputPath, `${JSON.stringify(rows)}\n`);
  return {
    directory,
    inputPath,
    sessionPath: join(directory, "review.session.json"),
    reviewedOutputPath: join(directory, "reviewed.json"),
    auditOutputPath: join(directory, "audit.json"),
    reviewer: { name: "Ada Reviewer", email: "ada@example.test" },
  };
}

function deps(overrides: Partial<ReviewWorkspaceDependencies> = {}): ReviewWorkspaceDependencies {
  let event = 0;
  return {
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    eventId: () => `event-${++event}`,
    lockId: () => "process-uuid-test",
    processExists: () => false,
    pid: 12345,
    ...overrides,
  };
}

describe("visual metadata review session store", () => {
  it("hashes and validates the immutable source before creating a session", async () => {
    const config = await fixture();
    const source = await loadVisualMetadataReviewSource(config.inputPath);

    expect(source).toMatchObject({ counts: { rows: 1, unique: 1, suggested: 1, failed: 0, requiredApprovals: 1 } });
    await expect(openVisualMetadataReviewWorkspace(config, deps())).resolves.toBeDefined();
    expect(JSON.parse(await readFile(config.sessionPath, "utf8"))).toMatchObject({ source: { sha256: source.sha256 } });
  });

  it("resumes only when the source hash and reviewer identity match", async () => {
    const config = await fixture();
    const initial = await openVisualMetadataReviewWorkspace(config, deps());
    await initial.close();
    await expect(openVisualMetadataReviewWorkspace(config, deps())).resolves.toBeDefined();
    await expect(openVisualMetadataReviewWorkspace({ ...config, reviewer: { ...config.reviewer, name: "Other" } }, deps()))
      .rejects.toMatchObject({ name: "ReviewWorkspaceResumeError" });
    await writeFile(config.inputPath, `${JSON.stringify([row("other")])}\n`);
    await expect(openVisualMetadataReviewWorkspace(config, deps())).rejects.toMatchObject({ name: "ReviewWorkspaceResumeError" });
  });

  it("refuses a corrupt session without overwriting it", async () => {
    const config = await fixture();
    const corrupt = "{not-json}\n";
    await writeFile(config.sessionPath, corrupt);

    await expect(openVisualMetadataReviewWorkspace(config, deps())).rejects.toMatchObject({ name: "ReviewWorkspaceResumeError" });
    expect(await readFile(config.sessionPath, "utf8")).toBe(corrupt);
  });

  it("serializes concurrent dispatch calls in event-sequence order", async () => {
    const config = await fixture([row("one"), row("two")]);
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    await Promise.all([
      workspace.dispatch({ action: "approved", templateId: "one" }),
      workspace.dispatch({ action: "approved", templateId: "two" }),
    ]);

    expect(workspace.snapshot().session.events.map((event) => [event.templateId, event.sequence]))
      .toEqual([["one", 1], ["two", 2]]);
    await workspace.close();
  });

  it("rejects a second live lock owner", async () => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => true }));

    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => true })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    await workspace.close();
  });

  it("reclaims a stale lock only after process absence and session validation", async () => {
    const config = await fixture();
    const first = await openVisualMetadataReviewWorkspace(config, deps());
    await first.close();
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify({
      version: "template-visual-metadata-review-lock/1.0", pid: 54321, processUuid: "old", startedAt: "2026-08-04T00:00:00.000Z",
    }));
    const reclaimed = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await reclaimed.close();
    await writeFile(config.sessionPath, "{broken}\n");
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify({
      version: "template-visual-metadata-review-lock/1.0", pid: 54321, processUuid: "old", startedAt: "2026-08-04T00:00:00.000Z",
    }));

    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceResumeError" });
    await expect(readFile(`${config.sessionPath}.lock`, "utf8")).resolves.toContain("processUuid");
  });

  it("keeps the source bytes unchanged across edits and exports", async () => {
    const config = await fixture();
    const sourceBytes = await readFile(config.inputPath);
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    await workspace.dispatch({ action: "metadata_updated", templateId: "one", field: "themeability", value: "low" });
    await workspace.dispatch({ action: "approved", templateId: "one" });
    await workspace.exportFinal();

    expect(await readFile(config.inputPath)).toEqual(sourceBytes);
    await workspace.close();
  });

  it("writes reviewed and audit files only when the final gate passes", async () => {
    const config = await fixture([row("one"), row("two")]);
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    await expect(workspace.exportFinal()).rejects.toThrow("final export is not enabled");
    await expect(readFile(config.reviewedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(config.auditOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await workspace.dispatch({ action: "approved", templateId: "one" });
    await workspace.dispatch({ action: "approved", templateId: "two" });
    const paths = await workspace.exportFinal();
    expect(isAbsolute(paths.reviewedPath)).toBe(false);
    expect(isAbsolute(paths.auditPath)).toBe(false);
    expect(paths.reviewedPath).not.toMatch(/^[A-Za-z]:[\\/]|^[\\/]{1,2}/);
    expect(paths.auditPath).not.toMatch(/^[A-Za-z]:[\\/]|^[\\/]{1,2}/);
    expect(resolve(process.cwd(), paths.reviewedPath)).toBe(config.reviewedOutputPath);
    expect(resolve(process.cwd(), paths.auditPath)).toBe(config.auditOutputPath);
    await expect(readFile(config.reviewedOutputPath, "utf8")).resolves.toContain("reviewed");
    await expect(readFile(config.auditOutputPath, "utf8")).resolves.toContain("review-audit");
    await workspace.close();
  });

  it("allows an audit backup but not reviewed export below the gate", async () => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());

    const { auditPath } = await workspace.exportAuditBackup();
    expect(isAbsolute(auditPath)).toBe(false);
    expect(auditPath).not.toMatch(/^[A-Za-z]:[\\/]|^[\\/]{1,2}/);
    expect(resolve(process.cwd(), auditPath)).toBe(config.auditOutputPath);
    await expect(readFile(config.auditOutputPath, "utf8")).resolves.toContain("review-audit");
    await expect(readFile(config.reviewedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await workspace.close();
  });
});
