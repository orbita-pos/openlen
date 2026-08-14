import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

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
  type SealedFableParityScorecard,
} from "@/lib/generation/fable-parity-scorecard";

type Environment = Readonly<Record<string, string | undefined>>;

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
): Promise<
  | { targetMode: "disabled"; enabled: false; verified: true }
  | { targetMode: "enabled"; enabled: true; verified: true; scorecardSha256: string }
> {
  const targetMode = env.OPENLEN_AI_CREATION_TARGET_MODE;
  if (targetMode !== "enabled" && targetMode !== "disabled") {
    throw new Error("deployment must explicitly declare OPENLEN_AI_CREATION_TARGET_MODE=enabled|disabled");
  }
  if (targetMode === "disabled") return { targetMode, enabled: false, verified: true };
  const configuredPath = env.OPENLEN_FABLE_PARITY_SCORECARD_PATH?.trim();
  const expectedHash = env.OPENLEN_FABLE_PARITY_SCORECARD_SHA256?.trim();
  if (!configuredPath || !expectedHash) throw new Error("verified passing Fable parity scorecard is required");
  const path = evidencePath(workspaceRoot, configuredPath);
  const manifest = JSON.parse(await readFile(path, "utf8")) as SealedFableParityScorecard;
  const score = verifyFableParityScorecard(manifest);
  if (manifest.scorecardSha256 !== expectedHash) throw new Error("scorecard hash does not match the approved release hash");
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
  return { targetMode, enabled: true, verified: true, scorecardSha256: manifest.scorecardSha256 };
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
    comparisons.push({
      comparisonId: row.comparisonId,
      openLenSide: assignment.openLenSide,
      technicalStatus: result.technicalStatus as FableParityComparisonResult["technicalStatus"],
      openLenEligible: result.openLenEligible as boolean,
      criticalFailures: result.criticalFailures as FableParityComparisonResult["criticalFailures"],
      paidCalls: result.paidCalls as FableParityComparisonResult["paidCalls"],
    });
  }
  return sealFableParityScorecard({ comparisons, decisions }, bundle.manifestSha256);
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
