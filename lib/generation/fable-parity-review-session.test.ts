import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendBlindDecision,
  appendBlindDecisionToSessionFile,
  completeBlindReviewSessionFile,
  completeBlindReviewSession,
  createBlindReviewSession,
  ensureBlindReviewSessionFile,
  loadVerifiedBlindReviewSource,
  resolveVerifiedBlindArtifact,
  sealBlindDecision,
  verifySealedBlindDecision,
  writeBlindArtifactBundle,
  type BlindComparisonArtifactsInput,
} from "./fable-parity-review-session";
import {
  buildVerifiedFableParityScorecard,
  verifyFableParityDeployGate,
  writeFableParityScorecardFile,
} from "@/scripts/fable-parity-scorecard";

let workspaceRoot: string | undefined;

afterEach(async () => {
  if (workspaceRoot?.startsWith(tmpdir())) await rm(workspaceRoot, { recursive: true, force: true });
  workspaceRoot = undefined;
});

function comparison(index: number): BlindComparisonArtifactsInput {
  const id = (index + 1).toString(16).padStart(24, "0");
  const screenshot = (side: "openlen" | "fable", viewport: "desktop" | "mobile") => ({
    bytes: Buffer.from(`${id}:${side}:${viewport}:full-page-bytes`),
    fullPage: true as const,
    viewport: viewport === "desktop" ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
  });
  return {
    comparisonId: id,
    promptManifestBytes: Buffer.from(JSON.stringify({ schemaVersion: "prompt/1", text: `review prompt ${index + 1}` })),
    openLen: {
      htmlBytes: Buffer.from(`<!doctype html><title>candidate ${index + 1}</title>`),
      desktop: screenshot("openlen", "desktop"),
      mobile: screenshot("openlen", "mobile"),
    },
    fable: {
      htmlBytes: Buffer.from(`<!doctype html><title>reference ${index + 1}</title>`),
      desktop: screenshot("fable", "desktop"),
      mobile: screenshot("fable", "mobile"),
    },
    resultBytes: Buffer.from(JSON.stringify({
      comparisonId: id,
      technicalStatus: "ok",
      openLenEligible: true,
      criticalFailures: [],
      paidCalls: [{ result: "delivered", costMicromxn: 1 }],
    })),
  };
}

async function bundle() {
  workspaceRoot = await mkdtemp(join(tmpdir(), "openlen-fable-parity-"));
  return writeBlindArtifactBundle({
    workspaceRoot,
    runId: "0123456789abcdef01234567",
    comparisons: Array.from({ length: 20 }, (_, index) => comparison(index)),
    openLenOnSideA: (index) => index % 2 === 0,
  });
}

describe("Fable parity blind artifact and review session", () => {
  it("writes one immutable 20-case bundle only below scratch/fable-parity and hashes every byte artifact", async () => {
    const written = await bundle();
    const expectedRoot = resolve(workspaceRoot!, "scratch", "fable-parity");
    expect(resolve(written.bundleRoot).startsWith(expectedRoot)).toBe(true);
    expect(written.manifest.comparisons).toHaveLength(20);
    expect(written.manifestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const row of written.manifest.comparisons) {
      expect(row.promptManifest.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(row.assignment.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(row.result.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      for (const side of [row.sides.A, row.sides.B]) {
        expect(side.html.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(side.desktop).toMatchObject({ fullPage: true, viewport: { width: 1440, height: 1000 } });
        expect(side.mobile).toMatchObject({ fullPage: true, viewport: { width: 390, height: 844 } });
      }
    }
    const envelope = JSON.parse(await readFile(written.manifestPath, "utf8")) as { manifestSha256: string };
    expect(envelope.manifestSha256).toBe(written.manifestSha256);
  });

  it("serves only opaque prompt/side routes and excludes identity, model, cost, and telemetry", async () => {
    const written = await bundle();
    const source = await loadVerifiedBlindReviewSource(workspaceRoot!, written.manifestPath);
    expect(source.comparisons).toHaveLength(20);
    expect(source.comparisons[0]).toEqual({
      comparisonId: "000000000000000000000001",
      promptManifestUrl: "/artifact/000000000000000000000001/prompt",
      A: {
        desktopUrl: "/artifact/000000000000000000000001/A/desktop",
        mobileUrl: "/artifact/000000000000000000000001/A/mobile",
      },
      B: {
        desktopUrl: "/artifact/000000000000000000000001/B/desktop",
        mobileUrl: "/artifact/000000000000000000000001/B/mobile",
      },
    });
    expect(JSON.stringify(source)).not.toMatch(/openlen|fable|provider|model|cost|telemetry|assignment|result/i);

    const served = await resolveVerifiedBlindArtifact(
      workspaceRoot!, written.manifestPath, "000000000000000000000001", "A", "desktop",
    );
    expect(served.contentType).toBe("image/png");
    expect(Buffer.from(served.bytes).toString("utf8")).toContain("openlen:desktop");
    expect("path" in served).toBe(false);
  });

  it("returns immutable verified bytes so a file swap after resolution cannot change the served payload", async () => {
    const written = await bundle();
    const row = written.manifest.comparisons[0]!;
    const resolved = await resolveVerifiedBlindArtifact(
      workspaceRoot!, written.manifestPath, row.comparisonId, "A", "desktop",
    );
    const verifiedBytes = Buffer.from(resolved.bytes);
    await writeFile(join(written.bundleRoot, row.sides.A.desktop.path), "swapped-after-verify");
    expect(Buffer.from(resolved.bytes)).toEqual(verifiedBytes);
    expect(Buffer.from(resolved.bytes).toString("utf8")).not.toContain("swapped-after-verify");
  });

  it.each(["html", "desktop", "mobile", "prompt", "assignment", "result"] as const)(
    "rejects review serving after %s bytes are changed",
    async (kind) => {
      const written = await bundle();
      const row = written.manifest.comparisons[0]!;
      const artifact = kind === "prompt" ? row.promptManifest
        : kind === "assignment" ? row.assignment
          : kind === "result" ? row.result
            : kind === "html" ? row.sides.A.html
              : row.sides.A[kind];
      await writeFile(join(written.bundleRoot, artifact.path), "tampered");
      await expect(loadVerifiedBlindReviewSource(workspaceRoot!, written.manifestPath)).rejects.toThrow(/hash|integrity/i);
    },
  );

  it("revalidates the complete artifact set before accepting and sealing each decision", async () => {
    const written = await bundle();
    const session = createBlindReviewSession("111111111111111111111111", written.manifestSha256);
    const command = {
      comparisonId: "000000000000000000000001",
      reviewerSessionId: session.reviewerSessionId,
      desktopPreference: "A" as const,
      mobilePreference: "tie" as const,
      overallPreference: "A" as const,
      wrongNicheSide: "none" as const,
      rubric: { niche: 8, fidelity: 7, polish: 8, coherence: 7, usability: 8 },
    };
    const decided = await appendBlindDecision(workspaceRoot!, written.manifestPath, session, command);
    expect(decided.decisions).toHaveLength(1);
    expect(verifySealedBlindDecision(decided.decisions[0]!, written.manifestSha256)).toEqual(command);
    await expect(appendBlindDecision(workspaceRoot!, written.manifestPath, decided, command)).rejects.toThrow(/already|duplicate/i);

    const screenshot = written.manifest.comparisons[1]!.sides.B.mobile;
    await writeFile(join(written.bundleRoot, screenshot.path), "tampered-after-first-decision");
    await expect(appendBlindDecision(workspaceRoot!, written.manifestPath, decided, {
      ...command,
      comparisonId: "000000000000000000000002",
    })).rejects.toThrow(/hash|integrity/i);
  });

  it("locks a complete 20-decision session and rejects premature completion", async () => {
    const written = await bundle();
    let session = createBlindReviewSession("222222222222222222222222", written.manifestSha256);
    expect(() => completeBlindReviewSession(session, "2026-08-13T00:00:00.000Z")).toThrow(/20|incomplete/i);
    for (const row of written.manifest.comparisons) {
      session = await appendBlindDecision(workspaceRoot!, written.manifestPath, session, {
        comparisonId: row.comparisonId,
        reviewerSessionId: session.reviewerSessionId,
        desktopPreference: "tie",
        mobilePreference: "tie",
        overallPreference: "tie",
        wrongNicheSide: "none",
        rubric: { niche: 7, fidelity: 7, polish: 7, coherence: 7, usability: 7 },
      });
    }
    const completed = completeBlindReviewSession(session, "2026-08-13T00:00:00.000Z");
    expect(completed.completedAt).toBe("2026-08-13T00:00:00.000Z");
    await expect(appendBlindDecision(workspaceRoot!, written.manifestPath, completed, {
      ...completed.decisions[0]!.decision,
      comparisonId: completed.decisions[0]!.decision.comparisonId,
    })).rejects.toThrow(/completed/i);
  }, 20_000);

  it("rejects partial-page screenshots before any artifact directory is created", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "openlen-fable-parity-"));
    const comparisons = Array.from({ length: 20 }, (_, index) => comparison(index));
    comparisons[0] = { ...comparisons[0]!, openLen: { ...comparisons[0]!.openLen, desktop: { ...comparisons[0]!.openLen.desktop, fullPage: false as never } } };
    await expect(writeBlindArtifactBundle({
      workspaceRoot,
      runId: "333333333333333333333333",
      comparisons,
      openLenOnSideA: () => true,
    })).rejects.toThrow(/full.page/i);
  });

  it("serializes concurrent persisted decisions and completion without losing locked state", async () => {
    const written = await bundle();
    const sessionPath = join(workspaceRoot!, "scratch", "fable-parity", "reviewers", "nested", "session.json");
    const reviewerSessionId = "444444444444444444444444";
    const decisionFor = (comparisonId: string) => ({
      comparisonId,
      reviewerSessionId,
      desktopPreference: "tie" as const,
      mobilePreference: "tie" as const,
      overallPreference: "tie" as const,
      wrongNicheSide: "none" as const,
      rubric: { niche: 7, fidelity: 7, polish: 7, coherence: 7, usability: 7 },
    });
    const initial = {
      ...createBlindReviewSession(reviewerSessionId, written.manifestSha256),
      decisions: written.manifest.comparisons.slice(0, 18).map((row) => sealBlindDecision(decisionFor(row.comparisonId), written.manifestSha256)),
    };
    await ensureBlindReviewSessionFile(workspaceRoot!, sessionPath, initial);
    const rows = written.manifest.comparisons;
    await Promise.all([
      appendBlindDecisionToSessionFile(workspaceRoot!, written.manifestPath, sessionPath, decisionFor(rows[18]!.comparisonId)),
      appendBlindDecisionToSessionFile(workspaceRoot!, written.manifestPath, sessionPath, decisionFor(rows[19]!.comparisonId)),
      completeBlindReviewSessionFile(workspaceRoot!, written.manifestPath, sessionPath, "2026-08-13T01:00:00.000Z"),
    ]);
    const persisted = JSON.parse(await readFile(sessionPath, "utf8")) as { decisions: unknown[]; completedAt: string | null };
    expect(persisted.decisions).toHaveLength(20);
    expect(persisted.completedAt).toBe("2026-08-13T01:00:00.000Z");
  }, 20_000);

  it("creates nested session parents below scratch and rejects arbitrary output paths", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "openlen-fable-parity-"));
    const session = createBlindReviewSession("555555555555555555555555", `sha256:${"e".repeat(64)}`);
    const nested = join(workspaceRoot, "scratch", "fable-parity", "reviewers", "deep", "session.json");
    await expect(ensureBlindReviewSessionFile(workspaceRoot, nested, session)).resolves.toEqual(session);
    expect(JSON.parse(await readFile(nested, "utf8"))).toEqual(session);
    await expect(ensureBlindReviewSessionFile(workspaceRoot, join(workspaceRoot, "outside.json"), session)).rejects.toThrow(/scratch|path|evidence/i);
  });

  it("activates only from the exact reverified artifact manifest and three completed source sessions", async () => {
    const written = await bundle();
    const sessionPaths: string[] = [];
    for (let reviewer = 1; reviewer <= 3; reviewer += 1) {
      const reviewerSessionId = String(reviewer).repeat(24);
      const decisions = written.manifest.comparisons.map((row) => sealBlindDecision({
        comparisonId: row.comparisonId,
        reviewerSessionId,
        desktopPreference: "tie",
        mobilePreference: "tie",
        overallPreference: "tie",
        wrongNicheSide: "none",
        rubric: { niche: 8, fidelity: 8, polish: 8, coherence: 8, usability: 8 },
      }, written.manifestSha256));
      const session = completeBlindReviewSession({
        ...createBlindReviewSession(reviewerSessionId, written.manifestSha256),
        decisions,
      }, `2026-08-13T0${reviewer}:00:00.000Z`);
      const sessionPath = join(workspaceRoot!, "scratch", "fable-parity", "reviewers", `${reviewer}.json`);
      await ensureBlindReviewSessionFile(workspaceRoot!, sessionPath, session);
      sessionPaths.push(sessionPath);
    }
    const scorecard = await buildVerifiedFableParityScorecard({
      workspaceRoot: workspaceRoot!,
      manifestPath: written.manifestPath,
      reviewSessionPaths: sessionPaths,
    });
    const scorecardPath = join(workspaceRoot!, "scratch", "fable-parity", "scorecards", "approved.json");
    await writeFableParityScorecardFile(workspaceRoot!, scorecardPath, scorecard);
    const env = {
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: scorecardPath,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: scorecard.scorecardSha256,
      OPENLEN_FABLE_REVIEW_MANIFEST_PATH: written.manifestPath,
      OPENLEN_FABLE_REVIEW_SESSION_PATHS: sessionPaths.join(","),
    };
    await expect(verifyFableParityDeployGate(env, workspaceRoot!)).resolves.toMatchObject({
      targetMode: "enabled",
      verified: true,
      scorecardSha256: scorecard.scorecardSha256,
    });
    await writeFile(sessionPaths[0]!, "{}");
    await expect(verifyFableParityDeployGate(env, workspaceRoot!)).rejects.toThrow(/session|review|invalid|source/i);
  });
});
