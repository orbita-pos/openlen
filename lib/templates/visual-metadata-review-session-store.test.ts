import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    eventId: () => `00000000-0000-4000-8000-${String(++event).padStart(12, "0")}`,
    lockId: () => "11111111-1111-4111-8111-111111111111",
    processExists: () => false,
    pid: 12345,
    ...overrides,
  };
}

function strictLock(overrides: Record<string, unknown> = {}) {
  return {
    version: "template-visual-metadata-review-lock/1.0",
    pid: 54321,
    processUuid: "22222222-2222-4222-8222-222222222222",
    startedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function strictGuard(overrides: Record<string, unknown> = {}) {
  return {
    version: "template-visual-metadata-review-lock-guard/1.0",
    pid: 54321,
    processUuid: "88888888-8888-4888-8888-888888888888",
    startedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function strictGuardRecovery(overrides: Record<string, unknown> = {}) {
  return { ...strictGuard({ version: "template-visual-metadata-review-lock-guard-recovery/1.0" }), ...overrides };
}

function recoveryMarkerName(recovery: ReturnType<typeof strictGuardRecovery>): string {
  return `${createHash("sha256").update(JSON.stringify(recovery)).digest("hex")}.owner`;
}

async function writeRecoveryLease(path: string, recovery: ReturnType<typeof strictGuardRecovery>): Promise<void> {
  await mkdir(path);
  await writeFile(join(path, recoveryMarkerName(recovery)), JSON.stringify(recovery));
}

async function readRecoveryLease(path: string): Promise<string> {
  const entries = await readdir(path);
  if (entries.length !== 1) throw new Error("expected exactly one recovery generation");
  return readFile(join(path, entries[0]), "utf8");
}

function successfulWrite(path: string) {
  return Promise.resolve({ targetPath: path, temporaryPath: `${path}.tmp` });
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

  it("persists navigation in the v1 session and resumes the exact current template", async () => {
    const config = await fixture([row("one"), row("two")]);
    let clock = 0;
    const dependencies = deps({
      now: () => new Date(`2026-08-04T12:00:0${clock++}.000Z`),
    });
    const initial = await openVisualMetadataReviewWorkspace(config, dependencies);
    await initial.setCurrentTemplate("two");
    const durable = JSON.parse(await readFile(config.sessionPath, "utf8"));

    expect(durable).toMatchObject({
      schemaVersion: "template-visual-metadata-review-session/1.0",
      currentTemplateId: "two",
      updatedAt: "2026-08-04T12:00:02.000Z",
    });
    await initial.close();

    const resumed = await openVisualMetadataReviewWorkspace(config, deps());
    expect(resumed.snapshot().currentTemplateId).toBe("two");
    expect(resumed.getSafeReviewDto().session).toMatchObject({ currentTemplateId: "two" });
    await resumed.close();
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
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(strictLock()));
    const reclaimed = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await reclaimed.close();
    await writeFile(config.sessionPath, "{broken}\n");
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(strictLock()));

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
    const audit = JSON.parse(await readFile(config.auditOutputPath, "utf8"));
    expect(audit).toMatchObject({
      schemaVersion: "template-visual-metadata-review-audit/1.0",
      reviewer: { name: "Ada Reviewer", email: "ada@example.test" },
      completedAt: null,
      exportedAt: "2026-08-04T12:00:00.000Z",
      finalCounts: { approved: 0, rejected: 0, failed: 0, pending: 1 },
      coverage: { numerator: 0, denominator: 1, fraction: "0/1" },
      templates: { one: { state: "pending" } },
    });
    await expect(readFile(config.reviewedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await workspace.close();
  });

  it("fails closed for a stale lock without a durable valid session", async () => {
    const config = await fixture();
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(strictLock()));

    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => true })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    await expect(readFile(`${config.sessionPath}.lock`, "utf8")).resolves.toContain("processUuid");
  });

  it("does not let a second reclaimer enter after the first holds the canonical guard", async () => {
    const config = await fixture();
    const first = await openVisualMetadataReviewWorkspace(config, deps());
    await first.close();
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(strictLock()));
    let claimed = false;
    let signalClaim: (() => void) | undefined;
    const claimReached = new Promise<void>((resolveClaim) => { signalClaim = resolveClaim; });
    let releaseClaim: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => { releaseClaim = resolveGate; });
    const contender = openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "33333333-3333-4333-8333-333333333333",
      onAfterStaleLockClaim: async () => { claimed = true; signalClaim!(); await gate; },
    }));
    const claimOutcome = await Promise.race([
      claimReached.then(() => "claimed"),
      contender.then(() => "settled", () => "settled"),
    ]);
    expect(claimOutcome).toBe("claimed");
    expect(claimed).toBe(true);
    await expect(openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "44444444-4444-4444-8444-444444444444",
      processExists: () => true,
    }))).rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    releaseClaim!();
    const winner = await contender;
    await winner.close();
  });

  it("fails close when the lock owner changes before close", async () => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(strictLock({
      pid: 12345, processUuid: "55555555-5555-4555-8555-555555555555",
    })));

    await expect(workspace.close()).rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    await expect(readFile(`${config.sessionPath}.lock`, "utf8")).resolves.toContain("55555555");
  });

  it.each([
    ["input", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, sessionPath: config.inputPath })],
    ["reviewed output", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, reviewedOutputPath: config.inputPath })],
    ["audit output", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, auditOutputPath: config.sessionPath })],
    ["outputs", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, auditOutputPath: config.reviewedOutputPath })],
    ["lock", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, reviewedOutputPath: `${config.sessionPath}.lock` })],
    ["lock guard", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, reviewedOutputPath: `${config.sessionPath}.lock.claim` })],
    ["lock guard recovery", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, auditOutputPath: `${config.sessionPath}.lock.claim.recovery` })],
    ["lock guard recovery companion", (config: Awaited<ReturnType<typeof fixture>>) => ({ ...config, reviewedOutputPath: `${config.sessionPath}.lock.claim.any-stale-generation` })],
  ])("rejects aliased %s paths before creating files", async (_name, alter) => {
    const config = await fixture();
    const aliased = alter(config);

    await expect(openVisualMetadataReviewWorkspace(aliased, deps())).rejects.toMatchObject({ name: "ReviewWorkspaceConfigError" });
    await expect(readFile(`${config.sessionPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("freezes resolved configuration and clones a command before queueing it", async () => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    const command = { action: "metadata_updated" as const, templateId: "one", field: "themeability" as const, value: "low" };
    const pending = workspace.dispatch(command);
    command.value = "high";
    config.sessionPath = join(config.directory, "mutated-session.json");
    config.auditOutputPath = join(config.directory, "mutated-audit.json");
    await pending;

    expect(JSON.parse(await readFile(join(config.directory, "review.session.json"), "utf8")).events[0].after).toBe("low");
    await workspace.exportAuditBackup();
    await expect(readFile(join(config.directory, "mutated-session.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(config.directory, "mutated-audit.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await workspace.close();
  });

  it("publishes durable audit before a failed reviewed write and freezes the workspace", async () => {
    const config = await fixture();
    let writes = 0;
    const workspace = await openVisualMetadataReviewWorkspace(config, deps({
      writeJson: async (path, value) => {
        writes += 1;
        if (path === config.reviewedOutputPath) throw new Error("reviewed write secret");
        await writeFile(path, JSON.stringify(value));
        return successfulWrite(path);
      },
    }));
    await workspace.dispatch({ action: "approved", templateId: "one" });

    await expect(workspace.exportFinal()).rejects.toMatchObject({ name: "ReviewWorkspacePersistenceError" });
    expect(writes).toBe(4);
    await expect(readFile(config.auditOutputPath, "utf8")).resolves.toContain("review-audit");
    await expect(readFile(config.reviewedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(workspace.dispatch({ action: "reopened", templateId: "one" })).rejects.toMatchObject({ name: "ReviewWorkspacePersistenceError" });
    expect(workspace.snapshot().session.events).toHaveLength(1);
    await workspace.close();
  });

  it("redacts hostile command values and freezes state at the last durable snapshot", async () => {
    const config = await fixture();
    let calls = 0;
    const workspace = await openVisualMetadataReviewWorkspace(config, deps({
      writeJson: async (path) => {
        calls += 1;
        if (calls === 2) throw new Error("SAVE_SECRET file:///private metadata ada@example.test");
        return successfulWrite(path);
      },
    }));
    await expect(workspace.dispatch({ action: "metadata_updated", templateId: "one", field: "themeability", value: "SAVE_SECRET" }))
      .rejects.toMatchObject({ name: "ReviewWorkspaceCommandError" });
    await expect(workspace.dispatch({ action: "approved", templateId: "one" })).rejects.toMatchObject({ name: "ReviewWorkspacePersistenceError" });
    expect(workspace.snapshot().session.events).toHaveLength(0);
    let failure: Error | undefined;
    try {
      await workspace.dispatch({ action: "approved", templateId: "one" });
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toBeDefined();
    const exposed = JSON.stringify({ message: failure!.message, stack: failure!.stack, cause: failure!.cause, error: failure! });
    for (const secret of ["SAVE_SECRET", "file:///private", "metadata", "ada@example.test"]) expect(exposed).not.toContain(secret);
    await workspace.close();
  });

  it("rejects cross-volume output paths that cannot be returned relative to the working directory", async () => {
    const config = await fixture();
    await expect(openVisualMetadataReviewWorkspace(config, deps({
      relativePath: () => "X:\\outside\\audit.json",
      pathIsAbsolute: () => true,
    }))).rejects.toMatchObject({ name: "ReviewWorkspaceConfigError" });
  });

  it.each([
    ["unknown key", strictLock({ unexpected: true })],
    ["invalid uuid", strictLock({ processUuid: "not-a-uuid" })],
    ["invalid date", strictLock({ startedAt: "2026-08-04" })],
    ["invalid pid", strictLock({ pid: 0 })],
  ])("fails closed for a strict lock with %s", async (_name, lock) => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    await workspace.close();
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(lock));

    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => true })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
  });

  it("normalizes reviewer identity once for create and resume", async () => {
    const config = await fixture();
    const first = await openVisualMetadataReviewWorkspace({ ...config, reviewer: { name: " Ada Reviewer ", email: " ada@example.test " } }, deps());
    await first.close();
    await expect(openVisualMetadataReviewWorkspace(config, deps())).resolves.toBeDefined();
  });

  it("never lets an A reclaimer rename B's later live owner after B wins the stale guard", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(strictLock()));
    let releaseARead: (() => void) | undefined;
    let signalARead: (() => void) | undefined;
    const aRead = new Promise<void>((resolveRead) => { signalARead = resolveRead; });
    const holdA = new Promise<void>((resolveHold) => { releaseARead = resolveHold; });
    const contenderA = openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "66666666-6666-4666-8666-666666666666",
      onAfterStaleLockRead: async () => { signalARead!(); await holdA; },
    }));
    const readOutcome = await Promise.race([aRead.then(() => "read"), contenderA.then(() => "settled", () => "settled")]);
    expect(readOutcome).toBe("read");
    const winnerB = await openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "77777777-7777-4777-8777-777777777777",
    }));
    releaseARead!();
    await expect(contenderA).rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    await expect(readFile(`${config.sessionPath}.lock`, "utf8")).resolves.toContain("77777777");
    await winnerB.close();
  });

  it("serializes close through an ownership guard so a reclaimer cannot replace between check and removal", async () => {
    const config = await fixture();
    let releaseClose: (() => void) | undefined;
    let signalCloseGuard: (() => void) | undefined;
    const closeGuard = new Promise<void>((resolveGuard) => { signalCloseGuard = resolveGuard; });
    const holdClose = new Promise<void>((resolveHold) => { releaseClose = resolveHold; });
    const workspace = await openVisualMetadataReviewWorkspace(config, deps({
      onAfterReleaseLockGuard: async () => { signalCloseGuard!(); await holdClose; },
    }));
    const closing = workspace.close();
    const guardOutcome = await Promise.race([closeGuard.then(() => "guarded"), closing.then(() => "settled", () => "settled")]);
    expect(guardOutcome).toBe("guarded");
    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => true })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    releaseClose!();
    await closing;
  });

  it.each([
    ["normalized calendar overflow", strictLock({ startedAt: "2026-02-30T00:00:00.000Z" })],
    ["non-canonical milliseconds", strictLock({ startedAt: "2026-08-04T00:00:00.00Z" })],
  ])("fails closed for lock timestamps with %s", async (_name, lock) => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    await workspace.close();
    await writeFile(`${config.sessionPath}.lock`, JSON.stringify(lock));
    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid injected PID %p before creating a lock", async (pid) => {
    const config = await fixture();
    await expect(openVisualMetadataReviewWorkspace(config, deps({ pid })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceConfigError" });
    await expect(readFile(`${config.sessionPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists a session that excludes source paths, raw evidence, and source metadata", async () => {
    const config = await fixture();
    const sourceRaw = "SOURCE_BYTES_MUST_REMAIN_PRIVATE";
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());
    const serialized = await readFile(config.sessionPath, "utf8");

    for (const forbidden of [config.inputPath, config.sessionPath, sourceRaw, "rawModelResponse", "developer_tools", "provenance"]) {
      expect(serialized).not.toContain(forbidden);
    }
    await workspace.close();
  });

  it("reclaims a dead stale canonical guard after validating the durable session", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    await writeFile(`${config.sessionPath}.lock.claim`, JSON.stringify(strictGuard()));

    const recovered = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await recovered.close();
    await expect(readFile(`${config.sessionPath}.lock.claim`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed while a canonical guard owner is live", async () => {
    const config = await fixture();
    await writeFile(`${config.sessionPath}.lock.claim`, JSON.stringify(strictGuard()));

    await expect(openVisualMetadataReviewWorkspace(config, deps({ processExists: () => true })))
      .rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
  });

  it("recovers a stale guard left after release cleanup failure", async () => {
    const config = await fixture();
    const workspace = await openVisualMetadataReviewWorkspace(config, deps({
      onAfterReleaseLockGuard: async () => {
        await writeFile(`${config.sessionPath}.lock.claim`, JSON.stringify(strictGuard()));
      },
    }));
    await expect(workspace.close()).rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });

    const recovered = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await recovered.close();
  });

  it("allows only one concurrent stale-guard recovery claimant", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    await writeFile(`${config.sessionPath}.lock.claim`, JSON.stringify(strictGuard()));
    let releaseA: (() => void) | undefined;
    let signalA: (() => void) | undefined;
    const aRead = new Promise<void>((resolveRead) => { signalA = resolveRead; });
    const holdA = new Promise<void>((resolveHold) => { releaseA = resolveHold; });
    const contenderA = openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "99999999-9999-4999-8999-999999999999",
      processExists: () => false,
      onAfterStaleGuardRead: async () => { signalA!(); await holdA; },
    }));
    const aOutcome = await Promise.race([aRead.then(() => "read"), contenderA.then(() => "settled", () => "settled")]);
    expect(aOutcome).toBe("read");
    const winnerB = await openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      processExists: () => false,
    }));
    releaseA!();
    await expect(contenderA).rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    await winnerB.close();
  });

  it("exposes only a copied safe DTO and exact per-ID screenshot source to the loopback server", async () => {
    const config = await fixture([row("one"), row("two")]);
    const privateScreenshot = "https://templates.openlen.com/screenshots/private-source.jpg";
    const source = JSON.parse(await readFile(config.inputPath, "utf8"));
    source[0].screenshotUrl = privateScreenshot;
    source[0].evidence.rawModelResponse = "RAW_PRIVATE_EVIDENCE";
    source[0].provenance.modelChoice.modelId = "PRIVATE_MODEL";
    await writeFile(config.inputPath, JSON.stringify(source));
    const workspace = await openVisualMetadataReviewWorkspace(config, deps());

    const dto = workspace.getSafeReviewDto();
    const serialized = JSON.stringify(dto);
    for (const forbidden of [
      privateScreenshot, "RAW_PRIVATE_EVIDENCE", "rawModelResponse", "PRIVATE_MODEL",
      config.inputPath, config.sessionPath, "reviewer@example.test",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(workspace.getScreenshotSourceUrl("one")).toBe(privateScreenshot);
    expect(workspace.getScreenshotSourceUrl("unknown")).toBeNull();
    dto.items[0].name = "mutated outside";
    expect(workspace.getSafeReviewDto().items[0].name).not.toBe("mutated outside");
    await workspace.setCurrentTemplate("two");
    expect(workspace.getSafeReviewDto().session).toMatchObject({ currentTemplateId: "two" });
    await workspace.close();
  });

  it("loads the store and server boundaries without evaluating the suggestion workflow or model module", async () => {
    vi.resetModules();
    vi.doMock("./visual-metadata-review-workflow", () => {
      throw new Error("suggestion workflow runtime must not load");
    });
    vi.doMock("./suggest-visual-metadata", () => {
      throw new Error("suggestion model runtime must not load");
    });
    try {
      await expect(import("./visual-metadata-review-session-store")).resolves.toMatchObject({
        openVisualMetadataReviewWorkspace: expect.any(Function),
      });
      await expect(import("./visual-metadata-review-server")).resolves.toMatchObject({
        startVisualMetadataReviewServer: expect.any(Function),
      });
    } finally {
      vi.doUnmock("./visual-metadata-review-workflow");
      vi.doUnmock("./suggest-visual-metadata");
    }
  });

  it("recovers a dead recovery lease left by a crashed guard reclaimer", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    await writeFile(`${config.sessionPath}.lock.claim.recovery`, JSON.stringify(strictGuardRecovery()));

    const recovered = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await recovered.close();
    await expect(readFile(`${config.sessionPath}.lock.claim.recovery`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows only one concurrent stale recovery-lease claimant", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    await writeFile(`${config.sessionPath}.lock.claim.recovery`, JSON.stringify(strictGuardRecovery()));
    let releaseA: (() => void) | undefined;
    let signalA: (() => void) | undefined;
    const aRead = new Promise<void>((resolveRead) => { signalA = resolveRead; });
    const holdA = new Promise<void>((resolveHold) => { releaseA = resolveHold; });
    const contenderA = openVisualMetadataReviewWorkspace(config, deps({
      lockId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      processExists: () => false,
      onAfterStaleRecoveryRead: async () => { signalA!(); await holdA; },
    }));
    const aOutcome = await Promise.race([aRead.then(() => "read"), contenderA.then(() => "settled", () => "settled")]);
    expect(aOutcome).toBe("read");
    const winnerB = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    releaseA!();
    await expect(contenderA).rejects.toMatchObject({ name: "ReviewWorkspaceLockError" });
    await winnerB.close();
  });

  it("never lets a paused R1 reclaimer touch B's later live R2 recovery lease", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    const staleRecovery = strictGuardRecovery({
      pid: 51001,
      processUuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    await writeFile(`${config.sessionPath}.lock.claim`, JSON.stringify(strictGuard()));
    await writeRecoveryLease(`${config.sessionPath}.lock.claim.recovery`, staleRecovery);

    let releaseA: (() => void) | undefined;
    let signalA: (() => void) | undefined;
    const aRead = new Promise<void>((resolveRead) => { signalA = resolveRead; });
    const holdA = new Promise<void>((resolveHold) => { releaseA = resolveHold; });
    const contenderA = openVisualMetadataReviewWorkspace(config, deps({
      pid: 51002,
      lockId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      processExists: (pid) => pid === 52002,
      onAfterStaleRecoveryRead: async () => { signalA!(); await holdA; },
    }));
    await aRead;

    let releaseB: (() => void) | undefined;
    let signalB: (() => void) | undefined;
    const bOwnsR2 = new Promise<void>((resolveOwned) => { signalB = resolveOwned; });
    const holdB = new Promise<void>((resolveHold) => { releaseB = resolveHold; });
    let staleGuardChecks = 0;
    const contenderB = openVisualMetadataReviewWorkspace(config, deps({
      pid: 52002,
      lockId: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      processExists: async (pid) => {
        if (pid === 54321 && ++staleGuardChecks === 2) { signalB!(); await holdB; }
        return false;
      },
    }));
    await bOwnsR2;
    releaseA!();

    let openedA: Awaited<ReturnType<typeof openVisualMetadataReviewWorkspace>> | undefined;
    let errorA: unknown;
    try { openedA = await contenderA; } catch (error) { errorA = error; }
    let recoveryDuringB: string | undefined;
    try { recoveryDuringB = await readRecoveryLease(`${config.sessionPath}.lock.claim.recovery`); } catch { /* assertion below */ }
    releaseB!();
    let openedB: Awaited<ReturnType<typeof openVisualMetadataReviewWorkspace>> | undefined;
    try { openedB = await contenderB; } catch { /* assertions below identify the protocol failure */ }
    if (openedA) await openedA.close().catch(() => undefined);
    if (openedB) await openedB.close();

    expect(errorA).toMatchObject({ name: "ReviewWorkspaceLockError" });
    expect(recoveryDuringB).toContain("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(openedB).toBeDefined();
  });

  it("ignores a preexisting deterministic R1 claim when recovering that generation", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    const staleRecovery = strictGuardRecovery();
    const generation = createHash("sha256").update(JSON.stringify(staleRecovery)).digest("hex");
    await writeFile(`${config.sessionPath}.lock.claim`, JSON.stringify(strictGuard()));
    await writeRecoveryLease(`${config.sessionPath}.lock.claim.recovery`, staleRecovery);
    await mkdir(`${config.sessionPath}.lock.claim.recovery.${generation}.stale`);

    const recovered = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await recovered.close();
  });

  it("recovers an empty canonical recovery lease left after marker-retirement crash", async () => {
    const config = await fixture();
    const seed = await openVisualMetadataReviewWorkspace(config, deps());
    await seed.close();
    await mkdir(`${config.sessionPath}.lock.claim.recovery`);

    const recovered = await openVisualMetadataReviewWorkspace(config, deps({ processExists: () => false }));
    await recovered.close();
  });
});
