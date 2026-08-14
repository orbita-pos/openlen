import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  verifyBlindArtifactBundle,
  verifyBlindReviewSession,
  verifySealedBlindDecision,
  type BlindReviewSession,
} from "@/lib/generation/fable-parity-review-session";
import {
  sealFableParityScorecard,
  verifyFableParityScorecard,
  type BlindDecision,
  type FableParityComparisonResult,
  type FableParityScorecardProvenance,
  type SealedFableParityScorecard,
} from "@/lib/generation/fable-parity-scorecard";
import { canonicalJsonSha256 } from "@/lib/generation/content-hash";
import {
  verifyReleaseBuildAttestation,
  type ReleaseBuildAttestation,
} from "@/lib/generation/release-build-attestation";

type Environment = Readonly<Record<string, string | undefined>>;
const execFileAsync = promisify(execFile);

export interface FableParityDeployGateDeps {
  readonly currentRevision?: (workspaceRoot: string) => Promise<string>;
  readonly verifyBuildAttestation?: (workspaceRoot: string, expectedRevision: string) => Promise<ReleaseBuildAttestation>;
}

async function currentGitRevision(workspaceRoot: string): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-c", `safe.directory=${workspaceRoot.replaceAll("\\", "/")}`, "rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      windowsHide: true,
      maxBuffer: 8 * 1024,
    });
    return result.stdout.trim();
  } catch {
    throw new Error("current release revision could not be verified");
  }
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function evidencePath(workspaceRoot: string, path: string): string {
  const root = resolve(workspaceRoot, "scratch", "fable-parity");
  const absolute = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path);
  if (!inside(root, absolute)) throw new Error("scorecard evidence must remain below scratch/fable-parity");
  return absolute;
}

export async function verifyFableParityDeployGate(
  env: Environment,
  workspaceRoot = process.cwd(),
  deps: FableParityDeployGateDeps = {},
): Promise<
  | { targetMode: "disabled"; rolloutPercent: 0; enabled: false; verified: true }
  | { targetMode: "enabled"; rolloutPercent: number; enabled: true; verified: true; scorecardSha256: string; sourceRevision: string; buildId: string; artifactDigest: string }
> {
  const targetMode = env.OPENLEN_AI_CREATION_TARGET_MODE;
  if (targetMode !== "enabled" && targetMode !== "disabled") {
    throw new Error("deployment must explicitly declare OPENLEN_AI_CREATION_TARGET_MODE=enabled|disabled");
  }
  const rolloutRaw = env.OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT?.trim();
  if (targetMode === "disabled") {
    if (rolloutRaw !== "0") throw new Error("disabled deployment requires OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT=0");
    return { targetMode, rolloutPercent: 0, enabled: false, verified: true };
  }
  if (!/^(?:[1-9]|[1-9][0-9])$/.test(rolloutRaw ?? "")) {
    throw new Error("enabled deployment rollout percent must be an explicit integer from 1 through 99");
  }
  const rolloutPercent = Number(rolloutRaw);
  const configuredPath = env.OPENLEN_FABLE_PARITY_SCORECARD_PATH?.trim();
  const expectedHash = env.OPENLEN_FABLE_PARITY_SCORECARD_SHA256?.trim();
  if (!configuredPath || !expectedHash) throw new Error("verified passing Fable parity scorecard is required");
  const path = evidencePath(workspaceRoot, configuredPath);
  const manifest = JSON.parse(await readFile(path, "utf8")) as SealedFableParityScorecard;
  const score = verifyFableParityScorecard(manifest);
  if (manifest.scorecardSha256 !== expectedHash) throw new Error("scorecard hash does not match the approved release hash");
  const approvedRevision = env.OPENLEN_FABLE_PARITY_APPROVED_REVISION?.trim();
  if (!approvedRevision || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(approvedRevision)) {
    throw new Error("approved release revision is required");
  }
  const releaseRevision = await (deps.currentRevision ?? currentGitRevision)(workspaceRoot);
  if (releaseRevision !== approvedRevision) throw new Error("current release revision does not match approved revision");
  const buildAttestation = await (deps.verifyBuildAttestation ?? verifyReleaseBuildAttestation)(workspaceRoot, releaseRevision);
  if (manifest.source.sourceRevision !== approvedRevision
    || manifest.source.sourceRevision !== buildAttestation.sourceRevision
    || manifest.source.buildId !== buildAttestation.buildId
    || manifest.source.artifactDigest !== buildAttestation.artifactDigest
    || manifest.source.rolloutPercent !== rolloutPercent) {
    throw new Error("scorecard release provenance does not match approved revision, build attestation, or rollout");
  }
  const artifactManifestPath = env.OPENLEN_FABLE_REVIEW_MANIFEST_PATH?.trim();
  const reviewSessionPaths = env.OPENLEN_FABLE_REVIEW_SESSION_PATHS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (!artifactManifestPath || reviewSessionPaths.length !== 3) {
    throw new Error("activation requires the exact artifact manifest and three source review sessions");
  }
  const rebuilt = await buildVerifiedFableParityScorecard({
    workspaceRoot,
    manifestPath: artifactManifestPath,
    reviewSessionPaths,
  });
  verifyFableParityScorecard(rebuilt);
  if (rebuilt.scorecardSha256 !== manifest.scorecardSha256
    || rebuilt.evidenceSha256 !== manifest.evidenceSha256
    || rebuilt.source.artifactManifestSha256 !== manifest.source.artifactManifestSha256) {
    throw new Error("scorecard does not match verified source artifacts and review sessions");
  }
  if (!score.passed) throw new Error("Fable parity scorecard did not pass");
  return {
    targetMode,
    rolloutPercent,
    enabled: true,
    verified: true,
    scorecardSha256: manifest.scorecardSha256,
    sourceRevision: releaseRevision,
    buildId: buildAttestation.buildId,
    artifactDigest: buildAttestation.artifactDigest,
  };
}

function parseJson(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${label} artifact is invalid`);
  }
}

function scorecardProvenance(value: FableParityScorecardProvenance): FableParityScorecardProvenance {
  return {
    authorizationManifestSha256: value.authorizationManifestSha256,
    cohortVersion: value.cohortVersion,
    cohortSha256: value.cohortSha256,
    sourceRevision: value.sourceRevision,
    buildId: value.buildId,
    artifactDigest: value.artifactDigest,
    immutableRateCardSha256: value.immutableRateCardSha256,
    rolloutPercent: value.rolloutPercent,
  };
}

export async function buildVerifiedFableParityScorecard(options: {
  readonly workspaceRoot: string;
  readonly manifestPath: string;
  readonly reviewSessionPaths: readonly string[];
}): Promise<SealedFableParityScorecard> {
  const bundle = await verifyBlindArtifactBundle(options.workspaceRoot, options.manifestPath);
  if (options.reviewSessionPaths.length !== 3) throw new Error("scorecard requires exactly three completed review sessions");
  const reviewerIds = new Set<string>();
  const decisions: BlindDecision[] = [];
  for (const configuredPath of options.reviewSessionPaths) {
    const sessionPath = evidencePath(options.workspaceRoot, configuredPath);
    const session = verifyBlindReviewSession(JSON.parse(await readFile(sessionPath, "utf8"))) as BlindReviewSession;
    if (session.schemaVersion !== "blind-review-session/1.0" || session.completedAt === null
      || session.artifactManifestSha256 !== bundle.manifestSha256 || session.decisions.length !== 20
      || reviewerIds.has(session.reviewerSessionId)) {
      throw new Error("review session is incomplete, duplicated, or bound to different evidence");
    }
    reviewerIds.add(session.reviewerSessionId);
    for (const sealed of session.decisions) {
      const decision = verifySealedBlindDecision(sealed, bundle.manifestSha256);
      if (decision.reviewerSessionId !== session.reviewerSessionId) throw new Error("reviewer decision identity mismatch");
      decisions.push(decision);
    }
  }
  const comparisons: FableParityComparisonResult[] = [];
  for (const row of bundle.manifest.comparisons) {
    const assignmentBytes = bundle.verifiedArtifactBytes.get(resolve(bundle.bundleRoot, row.assignment.path));
    const resultBytes = bundle.verifiedArtifactBytes.get(resolve(bundle.bundleRoot, row.result.path));
    if (!assignmentBytes || !resultBytes) throw new Error("verified comparison evidence is incomplete");
    const assignment = parseJson(Buffer.from(assignmentBytes), "assignment");
    const result = parseJson(Buffer.from(resultBytes), "result");
    if (assignment.comparisonId !== row.comparisonId || result.comparisonId !== row.comparisonId
      || (assignment.openLenSide !== "A" && assignment.openLenSide !== "B")) {
      throw new Error("comparison assignment/result mismatch");
    }
    const resultProvenance = result.provenance as Record<string, unknown> | undefined;
    const openLen = result.openLen as Record<string, unknown> | undefined;
    const fable = result.fable as Record<string, unknown> | undefined;
    if (!resultProvenance || !openLen || !fable
      || canonicalJsonSha256(scorecardProvenance(bundle.manifest.provenance))
        !== canonicalJsonSha256(scorecardProvenance(resultProvenance as unknown as FableParityScorecardProvenance))) {
      throw new Error("comparison result provenance does not match the sealed artifact manifest");
    }
    comparisons.push({
      comparisonId: row.comparisonId,
      openLenSide: assignment.openLenSide,
      technicalStatus: result.technicalStatus as FableParityComparisonResult["technicalStatus"],
      openLenEligible: result.openLenEligible as boolean,
      criticalFailures: result.criticalFailures as FableParityComparisonResult["criticalFailures"],
      paidCalls: openLen.paidCalls as FableParityComparisonResult["paidCalls"],
      referencePaidCalls: fable.paidCalls as FableParityComparisonResult["referencePaidCalls"],
      openLenRequestSha256: openLen.requestSha256 as string,
      fableRequestSha256: fable.requestSha256 as string,
      openLenAttestationSha256: openLen.attestationSha256 as string,
      fableAttestationSha256: fable.attestationSha256 as string,
    });
  }
  return sealFableParityScorecard(
    { comparisons, decisions },
    bundle.manifestSha256,
    scorecardProvenance(bundle.manifest.provenance),
  );
}

export async function writeFableParityScorecardFile(
  workspaceRoot: string,
  configuredPath: string,
  scorecard: SealedFableParityScorecard,
): Promise<string> {
  verifyFableParityScorecard(scorecard);
  const path = evidencePath(workspaceRoot, configuredPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(scorecard, null, 2)}\n`, { flag: "wx" });
  return path;
}

async function main(): Promise<void> {
  if (process.argv.includes("--deploy-gate")) {
    const verified = await verifyFableParityDeployGate(process.env);
    console.log(JSON.stringify({ event: "fable_parity_deploy_gate", ...verified }));
    return;
  }
  const manifestPath = process.env.OPENLEN_FABLE_REVIEW_MANIFEST_PATH?.trim();
  const sessionPaths = process.env.OPENLEN_FABLE_REVIEW_SESSION_PATHS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const outputPath = process.env.OPENLEN_FABLE_PARITY_SCORECARD_OUTPUT?.trim();
  if (!manifestPath || !outputPath) throw new Error("scorecard input/output paths are required");
  const workspaceRoot = process.cwd();
  const scorecard = await buildVerifiedFableParityScorecard({ workspaceRoot, manifestPath, reviewSessionPaths: sessionPaths });
  await writeFableParityScorecardFile(workspaceRoot, outputPath, scorecard);
  console.log(JSON.stringify({ event: "fable_parity_scorecard", scorecardSha256: scorecard.scorecardSha256, ...scorecard.score }));
  if (!scorecard.score.passed) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("Fable parity scorecard failed (details redacted).");
    process.exitCode = 1;
  });
}
