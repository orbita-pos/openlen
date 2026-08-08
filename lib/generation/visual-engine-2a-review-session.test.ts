import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEvidenceManifest } from "./visual-engine-2a-eval";
import {
  appendVisualEngine2ADecision,
  buildBlindReviewDto,
  completeVisualEngine2AReview,
  createVisualEngine2AReviewSession,
  resumeVisualEngine2AReviewSession,
  loadVisualEngine2AReviewSource,
} from "./visual-engine-2a-review-session";

const source = [{
  comparisonId: "comparison-1", pilotRunId: "run-1",
  baseline: { normal: "aa/base.jpg", neutral: "aa/base-neutral.jpg" },
  candidate: { normal: "bb/candidate.jpg", neutral: "bb/candidate-neutral.jpg" },
  hashes: {
    baseline: { normal: `sha256:${"1".repeat(64)}`, neutral: `sha256:${"2".repeat(64)}` },
    candidate: { normal: `sha256:${"3".repeat(64)}`, neutral: `sha256:${"4".repeat(64)}` },
  },
}];
let temporaryRoot: string | undefined;
afterEach(async () => {
  if (temporaryRoot?.startsWith(tmpdir())) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

function canonicalManifestDirectory(manifest: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))));
  return createHash("sha256").update(canonical).digest("hex");
}

describe("Visual Engine 2A blind review session", () => {
  it("randomizes sides while excluding semantic labels and secrets from the DTO", () => {
    const session = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.9);
    const dto = buildBlindReviewDto(session);
    const serialized = JSON.stringify(dto);
    expect(dto.current?.left.normalUrl).toMatch(/^\/evidence\//);
    for (const secret of ["baseline", "candidate", "pilotRunId", "sourcePath", "email", "credential"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("resumes only the same source and makes duplicate decisions idempotent", () => {
    const original = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.1);
    expect(() => resumeVisualEngine2AReviewSession(original, "sha256:" + "b".repeat(64), source)).toThrow(/source/i);
    const command = {
      comparisonId: "comparison-1", decision: "left" as const,
      requiredSignalsPresent: true, forbiddenSignalsPresent: false, note: "clearer identity",
    };
    const decided = appendVisualEngine2ADecision(original, command, "2026-08-07T00:00:00.000Z");
    expect(appendVisualEngine2ADecision(decided, command, "2026-08-07T00:00:01.000Z")).toEqual(decided);
    expect(() => appendVisualEngine2ADecision(decided, { ...command, decision: "right" }, "2026-08-07T00:00:01.000Z")).toThrow(/already/i);
  });

  it("completion is immutable", () => {
    const session = createVisualEngine2AReviewSession("sha256:" + "a".repeat(64), source, () => 0.1);
    const decided = appendVisualEngine2ADecision(session, {
      comparisonId: "comparison-1", decision: "tie",
      requiredSignalsPresent: false, forbiddenSignalsPresent: false, note: "too similar",
    }, "2026-08-07T00:00:00.000Z");
    const complete = completeVisualEngine2AReview(decided, "2026-08-07T00:00:01.000Z");
    expect(() => appendVisualEngine2ADecision(complete, {
      comparisonId: "comparison-1", decision: "invalid",
      requiredSignalsPresent: false, forbiddenSignalsPresent: false, note: "render failed",
    }, "2026-08-07T00:00:02.000Z")).toThrow(/completed/i);
  });

  it("binds the source SHA to canonical manifest content and verified evidence bytes", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openlen-2a-evidence-"));
    const bytes = {
      baselineNormal: Buffer.from("baseline-normal"), baselineNeutral: Buffer.from("baseline-neutral"),
      candidateNormal: Buffer.from("candidate-normal"), candidateNeutral: Buffer.from("candidate-neutral"),
    };
    const manifest = buildEvidenceManifest({
      caseId: "case-1", scenarioId: "plain", pilotRunId: "run-1", ...bytes,
    });
    const directoryName = canonicalManifestDirectory(manifest as unknown as Record<string, unknown>);
    const directory = join(temporaryRoot, directoryName);
    await mkdir(directory);
    await Promise.all([
      writeFile(join(directory, "manifest.json"), JSON.stringify(manifest)),
      ...Object.entries(bytes).map(([name, value]) => writeFile(join(directory, `${name}.jpg`), value)),
    ]);

    const loaded = await loadVisualEngine2AReviewSource(temporaryRoot);
    expect(loaded.sourceSha).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(loaded.rows).toMatchObject([{
      pilotRunId: "run-1",
      baseline: { normal: `${directoryName}/baselineNormal.jpg` },
      hashes: { baseline: { normal: manifest.baselineNormalSha256 } },
    }]);
    const session = createVisualEngine2AReviewSession(loaded.sourceSha, loaded.rows, () => 0.1);
    const substitutedSession = structuredClone(session);
    substitutedSession.comparisons[0].evidence.baseline.normal = "other/path.jpg";
    expect(() => resumeVisualEngine2AReviewSession(substitutedSession, loaded.sourceSha, loaded.rows)).toThrow(/source|evidence/i);

    await writeFile(join(directory, "baselineNormal.jpg"), "mutated");
    await expect(loadVisualEngine2AReviewSource(temporaryRoot)).rejects.toThrow(/hash|evidence/i);
    await writeFile(join(directory, "baselineNormal.jpg"), bytes.baselineNormal);
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ ...manifest, caseId: "substituted" }));
    await expect(loadVisualEngine2AReviewSource(temporaryRoot)).rejects.toThrow(/manifest|directory|hash/i);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    const substituted = join(temporaryRoot, "0".repeat(64));
    await rename(directory, substituted);
    await expect(loadVisualEngine2AReviewSource(temporaryRoot)).rejects.toThrow(/manifest|directory|hash/i);
    expect(() => resumeVisualEngine2AReviewSession(session, "sha256:" + "b".repeat(64), loaded.rows)).toThrow(/source/i);
  });
});
