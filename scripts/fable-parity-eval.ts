import { createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildFableParityCohort,
  fableParityCohortSha256,
  type FableParityCohortRow,
  type FableParityPrompt,
  type SealedHiddenRecord,
} from "@/lib/generation/fable-parity-cohort";
import {
  createFableParityAggregateBudget,
  createFableParityEvaluatorRequest,
  createHmacFableParityAttestationVerifier,
  fableParityAuthorizationManifestSha256,
  hashFableParityAuthorizationToken,
  validateFableParityAuthorizationManifest,
  verifyFableParityAttestedResponse,
  type FableParityAttestationVerifier,
  type FableParityAttestedEvaluatorResponse,
  type FableParityEvalAuthorizationManifest,
  type FableParityEvaluatorRequest,
} from "@/lib/generation/fable-parity-evaluator-contract";
import { canonicalJsonSha256 } from "@/lib/generation/content-hash";
import {
  writeBlindArtifactBundle,
  type BlindComparisonArtifactsInput,
} from "@/lib/generation/fable-parity-review-session";

export const FABLE_PARITY_EVAL_AUTHORIZATION = "AUTHORIZED_FABLE_PARITY_EVAL_ONCE";

type Environment = Readonly<Record<string, string | undefined>>;

export interface FableParityEvalCliDeps {
  readonly env: Environment;
  readonly loadAuthorizationManifest: () => Promise<unknown>;
  readonly loadSealedRecords: () => Promise<readonly SealedHiddenRecord[]>;
  readonly decryptHiddenRecord: (record: SealedHiddenRecord, index: number) => Promise<unknown>;
  readonly consumeAuthorization: (input: { readonly manifestSha256: string; readonly tokenSha256: string }) => Promise<void>;
  readonly generateOpenLen: (request: FableParityEvaluatorRequest, row: FableParityCohortRow) => Promise<FableParityAttestedEvaluatorResponse>;
  readonly generateFable: (request: FableParityEvaluatorRequest, row: FableParityCohortRow) => Promise<FableParityAttestedEvaluatorResponse>;
  readonly verifyAttestation: FableParityAttestationVerifier;
  readonly writeBundle: (input: {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly comparisons: readonly BlindComparisonArtifactsInput[];
    readonly provenance: {
      readonly authorizationManifestSha256: string;
      readonly cohortVersion: string;
      readonly cohortSha256: string;
      readonly sourceRevision: string;
      readonly buildId: string;
      readonly artifactDigest: string;
      readonly immutableRateCardSha256: string;
      readonly rolloutPercent: number;
    };
  }) => Promise<{ readonly manifestPath: string; readonly manifestSha256: string }>;
  readonly randomRunId: () => string;
  readonly workspaceRoot?: string;
}

function positiveSafeInteger(env: Environment, name: string): number {
  const value = Number(env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function validateFableParityEvalEnvironment(env: Environment, manifestValue?: unknown): FableParityEvalAuthorizationManifest {
  if (env.OPENLEN_FABLE_PARITY_LIVE !== "1") throw new Error("live evaluation gate is closed");
  if (env.OPENLEN_FABLE_PARITY_AUTHORIZATION !== FABLE_PARITY_EVAL_AUTHORIZATION) throw new Error("one-time authorization is invalid");
  const expectedManifestSha256 = env.OPENLEN_FABLE_PARITY_AUTHORIZATION_MANIFEST_SHA256;
  if (!expectedManifestSha256 || !/^sha256:[a-f0-9]{64}$/.test(expectedManifestSha256) || manifestValue === undefined) throw new Error("owner-approved authorization manifest is required");
  const manifest = validateFableParityAuthorizationManifest(manifestValue);
  if (fableParityAuthorizationManifestSha256(manifest) !== expectedManifestSha256) throw new Error("authorization manifest hash is stale");
  if (hashFableParityAuthorizationToken(env.OPENLEN_FABLE_PARITY_AUTHORIZATION) !== manifest.oneTimeTokenSha256) throw new Error("authorization token is not bound to the manifest");
  const pageCapMicromxn = positiveSafeInteger(env, "OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN");
  if (pageCapMicromxn !== manifest.caps.openLenPageMicromxn) throw new Error("OpenLen page cap does not match authorization manifest");
  const referencePageCapMicromxn = positiveSafeInteger(env, "OPENLEN_FABLE_PARITY_REFERENCE_PAGE_CAP_MICROMXN");
  if (referencePageCapMicromxn !== manifest.caps.fablePageMicromxn) throw new Error("Fable page cap does not match authorization manifest");
  const totalCapMicromxn = positiveSafeInteger(env, "OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN");
  const authorizedMaximum = 20 * (pageCapMicromxn + referencePageCapMicromxn);
  if (totalCapMicromxn !== authorizedMaximum || totalCapMicromxn !== manifest.caps.aggregateMicromxn) throw new Error("total cap must equal the exact authorized theoretical maximum");
  const declaredModels = [env.OPENLEN_FABLE_PARITY_REASONER_MODEL, env.OPENLEN_FABLE_PARITY_DESIGNER_MODEL, env.OPENLEN_FABLE_PARITY_CRITIC_MODEL, env.OPENLEN_FABLE_PARITY_IMAGE_MODEL];
  if (JSON.stringify(declaredModels) !== JSON.stringify(manifest.adapters.openlen.modelIds)
    || JSON.stringify([env.OPENLEN_FABLE_PARITY_REFERENCE_MODEL]) !== JSON.stringify(manifest.adapters.fable.modelIds)) throw new Error("declared models do not match authorization manifest");
  const actualRateCard = env.OPENLEN_FABLE_PARITY_RATE_CARD_SHA256;
  const reviewedRateCard = env.OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256;
  if (!actualRateCard || !/^sha256:[a-f0-9]{64}$/.test(actualRateCard) || actualRateCard !== reviewedRateCard || actualRateCard !== manifest.immutableRateCardSha256) {
    throw new Error("reviewed rate card hash is missing or stale");
  }
  return manifest;
}

function promptManifest(prompt: FableParityPrompt): Uint8Array {
  return Buffer.from(JSON.stringify({
    schemaVersion: "fable-parity-prompt/1.0",
    version: prompt.version,
    prompt: prompt.prompt,
    niche: prompt.niche,
    direction: prompt.direction,
    forbiddenSignals: prompt.forbiddenSignals,
  }));
}

export async function runFableParityEvalCli(deps: FableParityEvalCliDeps): Promise<
  | { readonly ok: false; readonly code: "closed" }
  | { readonly ok: true; readonly comparisons: 20; readonly openLenCalls: 20; readonly fableCalls: 20; readonly manifestPath: string; readonly manifestSha256: string; readonly authorizedMaximumMicromxn: number; readonly authorizationManifestSha256: string }
> {
  let manifest: FableParityEvalAuthorizationManifest;
  let authorizationManifestSha256: string;
  try {
    manifest = validateFableParityEvalEnvironment(deps.env, await deps.loadAuthorizationManifest());
    authorizationManifestSha256 = fableParityAuthorizationManifestSha256(manifest);
  } catch {
    return { ok: false, code: "closed" };
  }
  try {
    await deps.consumeAuthorization({ manifestSha256: authorizationManifestSha256, tokenSha256: manifest.oneTimeTokenSha256 });
  } catch {
    return { ok: false, code: "closed" };
  }
  const cohort = await buildFableParityCohort(await deps.loadSealedRecords(), deps.decryptHiddenRecord);
  if (fableParityCohortSha256(cohort) !== manifest.cohort.sha256) throw new Error("cohort hash does not match authorization manifest");
  const comparisons: BlindComparisonArtifactsInput[] = [];
  const aggregateBudget = createFableParityAggregateBudget(manifest);
  let openLenCalls = 0;
  let fableCalls = 0;
  for (const row of cohort) {
    const promptSha256 = canonicalJsonSha256(JSON.parse(Buffer.from(promptManifest(row.prompt)).toString("utf8")));
    const openLenReservation = aggregateBudget.reserve("openlen");
    const openLenRequest = createFableParityEvaluatorRequest({
      manifest, manifestSha256: authorizationManifestSha256, comparisonId: row.comparisonId, ordinal: row.ordinal,
      promptSha256, side: "openlen", sequence: openLenReservation.sequence,
      aggregateRemainingBeforeMicromxn: openLenReservation.aggregateRemainingBeforeMicromxn,
      aggregateRemainingAfterReservationMicromxn: openLenReservation.aggregateRemainingAfterReservationMicromxn,
    });
    const openLenEnvelope = await deps.generateOpenLen(openLenRequest, row);
    openLenCalls += 1;
    const openLen = await verifyFableParityAttestedResponse(openLenRequest, openLenEnvelope, deps.verifyAttestation);
    aggregateBudget.settle(openLenReservation, openLen.costMicromxn);

    const fableReservation = aggregateBudget.reserve("fable");
    const fableRequest = createFableParityEvaluatorRequest({
      manifest, manifestSha256: authorizationManifestSha256, comparisonId: row.comparisonId, ordinal: row.ordinal,
      promptSha256, side: "fable", sequence: fableReservation.sequence,
      aggregateRemainingBeforeMicromxn: fableReservation.aggregateRemainingBeforeMicromxn,
      aggregateRemainingAfterReservationMicromxn: fableReservation.aggregateRemainingAfterReservationMicromxn,
    });
    const fableEnvelope = await deps.generateFable(fableRequest, row);
    fableCalls += 1;
    const fable = await verifyFableParityAttestedResponse(fableRequest, fableEnvelope, deps.verifyAttestation);
    aggregateBudget.settle(fableReservation, fable.costMicromxn);
    const technicalStatus = openLen.technicalStatus === "failed" && fable.technicalStatus === "failed" ? "both_failure"
      : openLen.technicalStatus === "failed" ? "openlen_failure"
        : fable.technicalStatus === "failed" ? "fable_failure" : "ok";
    comparisons.push({
      comparisonId: row.comparisonId,
      promptManifestBytes: promptManifest(row.prompt),
      openLen,
      fable,
      resultBytes: Buffer.from(JSON.stringify({
        comparisonId: row.comparisonId,
        technicalStatus,
        openLenEligible: openLen.eligible,
        criticalFailures: openLen.criticalFailures,
        provenance: {
          authorizationManifestSha256,
          cohortVersion: manifest.cohort.version,
          cohortSha256: manifest.cohort.sha256,
          sourceRevision: manifest.source.revision,
          buildId: manifest.source.buildId,
          artifactDigest: manifest.source.artifactDigest,
          immutableRateCardSha256: manifest.immutableRateCardSha256,
          rolloutPercent: manifest.rolloutPercent,
          adapters: manifest.adapters,
        },
        openLen: { technicalStatus: openLen.technicalStatus, eligible: openLen.eligible, criticalFailures: openLen.criticalFailures, paidCalls: openLen.paidCalls, costMicromxn: openLen.costMicromxn, requestSha256: openLen.requestSha256, attestationSha256: canonicalJsonSha256(openLenEnvelope.attestation) },
        fable: { technicalStatus: fable.technicalStatus, eligible: fable.eligible, criticalFailures: fable.criticalFailures, paidCalls: fable.paidCalls, costMicromxn: fable.costMicromxn, requestSha256: fable.requestSha256, attestationSha256: canonicalJsonSha256(fableEnvelope.attestation) },
      })),
    });
  }
  if (openLenCalls !== 20 || fableCalls !== 20) throw new Error("evaluation call count invariant failed");
  aggregateBudget.assertComplete();
  const written = await deps.writeBundle({
    workspaceRoot: deps.workspaceRoot ?? process.cwd(),
    runId: deps.randomRunId(),
    comparisons,
    provenance: {
      authorizationManifestSha256,
      cohortVersion: manifest.cohort.version,
      cohortSha256: manifest.cohort.sha256,
      sourceRevision: manifest.source.revision,
      buildId: manifest.source.buildId,
      artifactDigest: manifest.source.artifactDigest,
      immutableRateCardSha256: manifest.immutableRateCardSha256,
      rolloutPercent: manifest.rolloutPercent,
    },
  });
  return {
    ok: true,
    comparisons: 20,
    openLenCalls: 20,
    fableCalls: 20,
    manifestPath: written.manifestPath,
    manifestSha256: written.manifestSha256,
    authorizedMaximumMicromxn: manifest.caps.aggregateMicromxn,
    authorizationManifestSha256,
  };
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function aesDecryptor(env: Environment) {
  const key = Buffer.from(required(env, "OPENLEN_FABLE_PARITY_HIDDEN_KEY_BASE64"), "base64");
  if (key.byteLength !== 32) throw new Error("hidden cohort key must be 32 bytes");
  return async (record: SealedHiddenRecord): Promise<unknown> => {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.nonceBase64, "base64"));
    decipher.setAuthTag(Buffer.from(record.authTagBase64, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(record.ciphertextBase64, "base64")),
      decipher.final(),
    ]).toString("utf8"));
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const hiddenPath = required(env, "OPENLEN_FABLE_PARITY_HIDDEN_COHORT_PATH");
  const authorizationManifestPath = required(env, "OPENLEN_FABLE_PARITY_AUTHORIZATION_MANIFEST_PATH");
  const verifierKey = Buffer.from(required(env, "OPENLEN_FABLE_PARITY_ATTESTATION_KEY_BASE64"), "base64");
  const verifierKeyId = required(env, "OPENLEN_FABLE_PARITY_ATTESTATION_KEY_ID");
  const unavailableAdapter = async (): Promise<never> => {
    throw new Error("No repository-owned reviewed live evaluator adapter is installed");
  };
  const result = await runFableParityEvalCli({
    env,
    loadAuthorizationManifest: async () => JSON.parse(await readFile(authorizationManifestPath, "utf8")),
    loadSealedRecords: async () => JSON.parse(await readFile(hiddenPath, "utf8")) as SealedHiddenRecord[],
    decryptHiddenRecord: aesDecryptor(env),
    consumeAuthorization: async ({ manifestSha256, tokenSha256 }) => {
      const marker = join(process.cwd(), "scratch", "fable-parity", "authorizations", `${manifestSha256.slice(7)}-${tokenSha256.slice(7)}.consumed`);
      await mkdir(dirname(marker), { recursive: true });
      await writeFile(marker, new Date().toISOString(), { flag: "wx" });
    },
    generateOpenLen: unavailableAdapter,
    generateFable: unavailableAdapter,
    verifyAttestation: createHmacFableParityAttestationVerifier(verifierKey, verifierKeyId),
    writeBundle: (input) => writeBlindArtifactBundle(input),
    randomRunId: () => randomBytes(12).toString("hex"),
  });
  if (!result.ok) throw new Error("Fable parity live gate is closed");
  console.log(JSON.stringify({ event: "fable_parity_eval_complete", ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("Fable parity evaluation failed (details redacted).");
    process.exitCode = 1;
  });
}
