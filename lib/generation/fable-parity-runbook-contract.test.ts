import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FABLE_MODEL_POLICY } from "./fable-model-policy";
import { canonicalJsonSha256 } from "./content-hash";
import { FABLE_PARITY_PUBLIC_COHORT, fableParityCohortSha256, opaqueComparisonId } from "./fable-parity-cohort";
import { sealFableParityScorecard, type BlindDecision, type FableParityComparisonResult } from "./fable-parity-scorecard";
import { verifyReleaseBuildAttestation, writeReleaseBuildAttestation } from "./release-build-attestation";
import {
  FABLE_PARITY_EVAL_AUTHORIZATION,
  runFableParityEvalCli,
  type FableParityEvalCliDeps,
} from "@/scripts/fable-parity-eval";
import { validateFableParityReviewServerEnvironment } from "@/scripts/fable-parity-review";
import { verifyFableParityDeployGate, writeFableParityScorecardFile } from "@/scripts/fable-parity-scorecard";
import {
  createFableParityProductionRuntimeDeps,
  runFableParityRollbackCli,
} from "@/scripts/fable-parity-rollback";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot?.startsWith(tmpdir())) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const HASH = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const SOURCE_REVISION = "bcb19ccd00f36e0a901ae2731e96f88bc8632b08";
const BUILD_ID = "openlen-build-20260813";
const ATTESTATION_KEY = Buffer.from("fable-parity-test-attestation-key-32b");
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==", "base64");
const EXTERNAL_PROMPTS = Array.from({ length: 8 }, (_, index) => ({
  recordId: `external-${index}`,
  version: "hidden/1" as const,
  prompt: `Externally decrypted release prompt ${index}`,
  niche: "unusual" as const,
  direction: index % 2 === 0 ? "explicit" as const : "underspecified" as const,
  forbiddenSignals: ["generic_saas"] as const,
}));
const AUTHORIZED_COHORT_SHA256 = fableParityCohortSha256([...FABLE_PARITY_PUBLIC_COHORT, ...EXTERNAL_PROMPTS].map((prompt, index) => ({
  ordinal: index + 1,
  comparisonId: opaqueComparisonId(prompt.version, prompt.recordId),
  prompt,
})));
const AUTHORIZATION_MANIFEST = {
  schemaVersion: "fable-parity-eval-authorization/2.0",
  oneTimeTokenSha256: `sha256:${createHash("sha256").update(FABLE_PARITY_EVAL_AUTHORIZATION).digest("hex")}`,
  cohort: { version: "fable-parity-cohort/1", sha256: AUTHORIZED_COHORT_SHA256 },
  source: { revision: SOURCE_REVISION, buildId: BUILD_ID, artifactDigest: HASH },
  rolloutPercent: 10,
  adapters: {
    openlen: { adapterId: "openlen-task5-production/1", endpointSha256: HASH, modelIds: [FABLE_MODEL_POLICY.reasoner.modelId, FABLE_MODEL_POLICY.designer.modelId, FABLE_MODEL_POLICY.visualCritic.modelId, "gemini-2.5-flash-image"] },
    fable: { adapterId: "fable-owner-reviewed-reference/1", endpointSha256: HASH_B, modelIds: ["fable-5"] },
  },
  immutableRateCardSha256: HASH,
  caps: { comparisonCount: 20, openLenPageMicromxn: 10_000_000, fablePageMicromxn: 2_000_000, aggregateMicromxn: 240_000_000 },
} as const;
const AUTHORIZATION_MANIFEST_SHA256 = canonicalJsonSha256(AUTHORIZATION_MANIFEST);
const VALID_ENV = {
  OPENLEN_FABLE_PARITY_LIVE: "1",
  OPENLEN_FABLE_PARITY_AUTHORIZATION: FABLE_PARITY_EVAL_AUTHORIZATION,
  OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "240000000",
  OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN: "10000000",
  OPENLEN_FABLE_PARITY_REFERENCE_PAGE_CAP_MICROMXN: "2000000",
  OPENLEN_FABLE_PARITY_REASONER_MODEL: FABLE_MODEL_POLICY.reasoner.modelId,
  OPENLEN_FABLE_PARITY_DESIGNER_MODEL: FABLE_MODEL_POLICY.designer.modelId,
  OPENLEN_FABLE_PARITY_CRITIC_MODEL: FABLE_MODEL_POLICY.visualCritic.modelId,
  OPENLEN_FABLE_PARITY_IMAGE_MODEL: "gemini-2.5-flash-image",
  OPENLEN_FABLE_PARITY_REFERENCE_MODEL: "fable-5",
  OPENLEN_FABLE_PARITY_RATE_CARD_SHA256: HASH,
  OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256: HASH,
  OPENLEN_FABLE_PARITY_AUTHORIZATION_MANIFEST_SHA256: AUTHORIZATION_MANIFEST_SHA256,
};

function sealedRecords() {
  return Array.from({ length: 8 }, (_, index) => ({
    sealedId: `sealed-${index}`,
    ciphertextBase64: Buffer.from(`ciphertext-${index}`).toString("base64"),
    nonceBase64: Buffer.from(`nonce-${index}`).toString("base64"),
    authTagBase64: Buffer.from(`tag-${index}`).toString("base64"),
  }));
}

function sideResult(label: string) {
  return {
    htmlBytes: Buffer.from(`<html>${label}</html>`),
    desktop: { bytes: JPEG, mimeType: "image/jpeg" as const, fullPage: true as const, viewport: { width: 64, height: 32 }, contentHeight: 64 },
    mobile: { bytes: JPEG, mimeType: "image/jpeg" as const, fullPage: true as const, viewport: { width: 64, height: 32 }, contentHeight: 64 },
    costMicromxn: 1,
    technicalStatus: "ok" as const,
    eligible: true,
    criticalFailures: [] as const,
    paidCalls: [{ result: "delivered" as const, costMicromxn: 1 }],
  };
}

function attest(request: Record<string, unknown>, result: ReturnType<typeof sideResult>, mutation: Record<string, unknown> = {}) {
  const boundResult = {
    ...result,
    manifestSha256: request.manifestSha256,
    requestSha256: request.requestSha256,
    side: request.side,
    adapterId: request.adapterId,
    endpointSha256: request.endpointSha256,
    modelIds: request.modelIds,
    sourceRevision: request.sourceRevision,
    buildId: request.buildId,
    artifactDigest: request.artifactDigest,
    immutableRateCardSha256: request.immutableRateCardSha256,
    rolloutPercent: request.rolloutPercent,
    ...mutation,
  };
  const signedPayloadSha256 = canonicalJsonSha256({ request, result: boundResult });
  return {
    result: boundResult,
    attestation: {
      schemaVersion: "fable-parity-eval-attestation/1.0",
      algorithm: "HMAC-SHA256",
      keyId: "owner-eval-key-1",
      signedPayloadSha256,
      signatureBase64Url: createHmac("sha256", ATTESTATION_KEY).update(signedPayloadSha256).digest("base64url"),
    },
  };
}

function attestedEvalDeps(responseMutation?: (side: "openlen" | "fable", ordinal: number, response: ReturnType<typeof attest>) => ReturnType<typeof attest>) {
  const state = evalDeps();
  const call = async (side: "openlen" | "fable", request: Record<string, unknown>, row: { ordinal: number }) => {
    const response = attest(request, sideResult(`${side}:${row.ordinal}`));
    return responseMutation?.(side, row.ordinal, response) ?? response;
  };
  return {
    ...state,
    deps: {
      ...state.deps,
      loadAuthorizationManifest: vi.fn(async () => AUTHORIZATION_MANIFEST),
      generateOpenLen: vi.fn((request: Record<string, unknown>, row: { ordinal: number }) => call("openlen", request, row)),
      generateFable: vi.fn((request: Record<string, unknown>, row: { ordinal: number }) => call("fable", request, row)),
      verifyAttestation: vi.fn(async (input: { signedPayloadSha256: string; signatureBase64Url: string; keyId: string }) => {
        if (input.keyId !== "owner-eval-key-1") return false;
        const expected = createHmac("sha256", ATTESTATION_KEY).update(input.signedPayloadSha256).digest();
        const actual = Buffer.from(input.signatureBase64Url, "base64url");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
      }),
    } as unknown as FableParityEvalCliDeps,
  };
}

function evalDeps(
  env: Readonly<Record<string, string | undefined>> = VALID_ENV,
  generateOpenLen?: FableParityEvalCliDeps["generateOpenLen"],
) {
  const order: string[] = [];
  const verifyAttestation = vi.fn(async (input: { signedPayloadSha256: string; signatureBase64Url: string; keyId: string }) => {
    if (input.keyId !== "owner-eval-key-1") return false;
    const expected = createHmac("sha256", ATTESTATION_KEY).update(input.signedPayloadSha256).digest();
    const actual = Buffer.from(input.signatureBase64Url, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  const deps: FableParityEvalCliDeps = {
    env,
    loadAuthorizationManifest: vi.fn(async () => AUTHORIZATION_MANIFEST),
    loadSealedRecords: vi.fn(async () => { order.push("hidden"); return sealedRecords(); }),
    consumeAuthorization: vi.fn(async () => undefined),
    decryptHiddenRecord: vi.fn(async (_record, index) => EXTERNAL_PROMPTS[index]!),
    generateOpenLen: vi.fn(async (request, row) => {
      order.push(`openlen:${row.ordinal}`);
      if (!generateOpenLen) return attest(request as unknown as Record<string, unknown>, sideResult(`openlen:${row.ordinal}`)) as never;
      const generated = await generateOpenLen(request, row);
      return generated && typeof generated === "object" && "attestation" in generated
        ? generated
        : attest(request as unknown as Record<string, unknown>, generated as never) as never;
    }),
    generateFable: vi.fn(async (request, row) => { order.push(`fable:${row.ordinal}`); return attest(request as unknown as Record<string, unknown>, sideResult(`fable:${row.ordinal}`)) as never; }),
    verifyAttestation,
    writeBundle: vi.fn(async (input) => { order.push(`write:${input.comparisons.length}`); return { manifestPath: "scratch/fable-parity/run/manifest.json", manifestSha256: HASH }; }),
    randomRunId: () => "0123456789abcdef01234567",
  };
  return { deps, order };
}

function passingScorecard() {
  const comparisons: FableParityComparisonResult[] = Array.from({ length: 20 }, (_, index) => ({
    comparisonId: `comparison-${index}`,
    openLenSide: index % 2 === 0 ? "A" : "B",
    technicalStatus: "ok",
    openLenEligible: index < 18,
    criticalFailures: [],
    paidCalls: [{ result: "delivered", costMicromxn: 1_000_000 }],
    referencePaidCalls: [{ result: "delivered", costMicromxn: 500_000 }],
    openLenRequestSha256: HASH,
    fableRequestSha256: HASH_B,
    openLenAttestationSha256: HASH,
    fableAttestationSha256: HASH_B,
  }));
  const outcomes = [...Array(8).fill("win"), ...Array(6).fill("tie"), ...Array(6).fill("loss")];
  const decisions: BlindDecision[] = comparisons.flatMap((row, index) => [1, 2, 3].map((reviewer) => {
    const openLen = row.openLenSide;
    const fable = openLen === "A" ? "B" : "A";
    const outcome = outcomes[index];
    return {
      comparisonId: row.comparisonId,
      reviewerSessionId: `reviewer-${reviewer}`,
      desktopPreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
      mobilePreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
      overallPreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
      wrongNicheSide: "none",
      rubric: { niche: 8, fidelity: 8, polish: 8, coherence: 8, usability: 8 },
    } as BlindDecision;
  }));
  return (sealFableParityScorecard as Function)({ comparisons, decisions }, HASH, {
    authorizationManifestSha256: AUTHORIZATION_MANIFEST_SHA256,
    cohortVersion: AUTHORIZATION_MANIFEST.cohort.version,
    cohortSha256: AUTHORIZATION_MANIFEST.cohort.sha256,
    sourceRevision: SOURCE_REVISION,
    buildId: BUILD_ID,
    artifactDigest: HASH,
    immutableRateCardSha256: HASH,
    rolloutPercent: 10,
  });
}

describe("Fable parity operational release controls", () => {
  it("seals the exact standalone build artifacts and rejects stale or substituted output", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openlen-build-attestation-"));
    const standalone = join(temporaryRoot, ".next", "standalone");
    const fixturePaths = [
      "server.js", "package.json", ".next/BUILD_ID", ".next/app-build-manifest.json",
      ".next/app-path-routes-manifest.json", ".next/build-manifest.json",
      ".next/required-server-files.json", ".next/routes-manifest.json",
      ".next/server/app-paths-manifest.json", ".next/server/chunks/release.js",
    ];
    for (const relativePath of fixturePaths) {
      const path = join(standalone, ...relativePath.split("/"));
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, relativePath === ".next/BUILD_ID" ? `${BUILD_ID}\n` : `release:${relativePath}`);
    }
    const written = await writeReleaseBuildAttestation(temporaryRoot, SOURCE_REVISION);
    await expect(verifyReleaseBuildAttestation(temporaryRoot, SOURCE_REVISION)).resolves.toEqual(written);
    await writeFile(join(standalone, ".next", "server", "chunks", "release.js"), "substituted");
    await expect(verifyReleaseBuildAttestation(temporaryRoot, SOURCE_REVISION)).rejects.toThrow(/artifact|attestation|substitut/i);
    await expect(verifyReleaseBuildAttestation(temporaryRoot, "c".repeat(40))).rejects.toThrow(/revision|stale/i);
  });

  it.each([
    ["live", { OPENLEN_FABLE_PARITY_LIVE: "0" }],
    ["authorization", { OPENLEN_FABLE_PARITY_AUTHORIZATION: "wrong" }],
    ["total cap", { OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "0" }],
    ["reserved cap", { OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "239999999" }],
    ["non-exact aggregate cap", { OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "240000001" }],
    ["page cap", { OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN: "9999999" }],
    ["model", { OPENLEN_FABLE_PARITY_DESIGNER_MODEL: "unreviewed" }],
    ["rate card", { OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256: `sha256:${"b".repeat(64)}` }],
  ])("closes the live eval on invalid %s before hidden data or provider boundaries", async (_label, override) => {
    const state = evalDeps({ ...VALID_ENV, ...override });
    const result = await runFableParityEvalCli(state.deps);
    expect(result.ok).toBe(false);
    expect(state.order).toEqual([]);
    expect(state.deps.loadSealedRecords).not.toHaveBeenCalled();
    expect(state.deps.generateOpenLen).not.toHaveBeenCalled();
    expect(state.deps.generateFable).not.toHaveBeenCalled();
  });

  it("accepts only owner-manifest-bound authenticated adapter results and seals both paid ledgers", async () => {
    const state = attestedEvalDeps();
    const result = await runFableParityEvalCli(state.deps);
    expect(result).toMatchObject({ ok: true, comparisons: 20, openLenCalls: 20, fableCalls: 20, authorizationManifestSha256: AUTHORIZATION_MANIFEST_SHA256 });
    expect(state.deps.generateOpenLen).toHaveBeenCalledTimes(20);
    expect(state.deps.generateFable).toHaveBeenCalledTimes(20);
    const bundle = vi.mocked(state.deps.writeBundle).mock.calls[0]![0];
    const sealed = JSON.parse(Buffer.from(bundle.comparisons[0]!.resultBytes).toString("utf8"));
    expect(sealed).toMatchObject({
      provenance: { authorizationManifestSha256: AUTHORIZATION_MANIFEST_SHA256, sourceRevision: SOURCE_REVISION, buildId: BUILD_ID, immutableRateCardSha256: HASH },
      openLen: { paidCalls: [{ result: "delivered", costMicromxn: 1 }] },
      fable: { paidCalls: [{ result: "delivered", costMicromxn: 1 }] },
    });
  });

  it.each([
    ["adapter", (response: ReturnType<typeof attest>) => ({ ...response, result: { ...response.result, adapterId: "arbitrary-adapter" } })],
    ["model", (response: ReturnType<typeof attest>) => ({ ...response, result: { ...response.result, modelIds: ["unreviewed-model"] } })],
    ["build", (response: ReturnType<typeof attest>) => ({ ...response, result: { ...response.result, buildId: "stale-build" } })],
    ["rate", (response: ReturnType<typeof attest>) => ({ ...response, result: { ...response.result, immutableRateCardSha256: HASH_B } })],
    ["request", (response: ReturnType<typeof attest>) => ({ ...response, result: { ...response.result, requestSha256: HASH_B } })],
    ["signature", (response: ReturnType<typeof attest>) => ({ ...response, attestation: { ...response.attestation, signatureBase64Url: "invalid" } })],
    ["fabricated ledger", (response: ReturnType<typeof attest>) => ({ ...response, result: { ...response.result, costMicromxn: 2 } })],
  ] as const)("rejects a signed or unsigned %s mismatch before evidence is written", async (label, mutate) => {
    const state = attestedEvalDeps((side, ordinal, response) => side === "openlen" && ordinal === 1 ? mutate(response) as ReturnType<typeof attest> : response);
    await expect(runFableParityEvalCli(state.deps)).rejects.toThrow(new RegExp(`${label}|attestation|ledger|provenance|request`, "i"));
    expect(state.deps.writeBundle).not.toHaveBeenCalled();
    expect(state.deps.generateOpenLen).toHaveBeenCalledTimes(1);
    expect(state.deps.generateFable).not.toHaveBeenCalled();
  });

  it("runs exactly twenty OpenLen and twenty Fable calls in strict case order with no harness retries", async () => {
    const state = evalDeps();
    const result = await runFableParityEvalCli(state.deps);
    expect(result).toEqual({ ok: true, comparisons: 20, openLenCalls: 20, fableCalls: 20, manifestPath: "scratch/fable-parity/run/manifest.json", manifestSha256: HASH, authorizedMaximumMicromxn: 240_000_000, authorizationManifestSha256: AUTHORIZATION_MANIFEST_SHA256 });
    expect(state.order).toEqual([
      "hidden",
      ...Array.from({ length: 20 }, (_, index) => [`openlen:${index + 1}`, `fable:${index + 1}`]).flat(),
      "write:20",
    ]);
  });

  it.each([
    ["technical status", { technicalStatus: "unknown" }],
    ["failed eligibility", { technicalStatus: "failed", eligible: true }],
    ["critical failure", { criticalFailures: ["not_a_release_failure"] }],
    ["desktop viewport", { desktop: { bytes: Buffer.from("desktop"), fullPage: true, viewport: { width: 0, height: 1000 } } }],
    ["successful paid accounting", { costMicromxn: 0, paidCalls: [] }],
  ])("rejects an adversarial %s mutation before writing review evidence", async (_label, override) => {
    const state = evalDeps(VALID_ENV, vi.fn(async () => ({ ...sideResult("mutated"), ...override } as never)));
    await expect(runFableParityEvalCli(state.deps)).rejects.toThrow(/technical|eligible|critical|viewport|paid|cost|artifact/i);
    expect(state.deps.writeBundle).not.toHaveBeenCalled();
  });

  it("permits a zero-cost failed pre-call only when it is ineligible and has no paid ledger entries", async () => {
    const state = evalDeps(VALID_ENV, vi.fn(async () => ({
      ...sideResult("pre-call-failure"),
      costMicromxn: 0,
      technicalStatus: "failed" as const,
      eligible: false,
      paidCalls: [],
    })) as never);
    await expect(runFableParityEvalCli(state.deps)).resolves.toMatchObject({ ok: true, comparisons: 20 });
  });

  it("requires a strong token and loopback binding for the review server", () => {
    expect(() => validateFableParityReviewServerEnvironment({ OPENLEN_FABLE_REVIEW_HOST: "0.0.0.0", OPENLEN_FABLE_REVIEW_TOKEN: "x".repeat(32) })).toThrow(/localhost|loopback/i);
    expect(() => validateFableParityReviewServerEnvironment({ OPENLEN_FABLE_REVIEW_HOST: "127.0.0.1", OPENLEN_FABLE_REVIEW_TOKEN: "short" })).toThrow(/token/i);
    expect(validateFableParityReviewServerEnvironment({ OPENLEN_FABLE_REVIEW_HOST: "127.0.0.1", OPENLEN_FABLE_REVIEW_TOKEN: "x".repeat(32), OPENLEN_FABLE_REVIEW_PORT: "4319" })).toEqual({ host: "127.0.0.1", port: 4319, token: "x".repeat(32) });
  });

  it("requires a hash-pinned verified passing scorecard only when AI creation is enabled", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openlen-fable-deploy-"));
    const directory = join(temporaryRoot, "scratch", "fable-parity", "release");
    await mkdir(directory, { recursive: true });
    const scorecard = passingScorecard();
    const path = join(directory, "scorecard.json");
    await writeFile(path, JSON.stringify(scorecard));

    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION: "enabled",
      OPENLEN_AI_CREATION_TARGET_MODE: "disabled",
      OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT: "0",
    }, temporaryRoot)).resolves.toEqual({ targetMode: "disabled", rolloutPercent: 0, enabled: false, verified: true });
    await expect(verifyFableParityDeployGate({ OPENLEN_AI_CREATION_TARGET_MODE: "enabled", OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT: "10" }, temporaryRoot)).rejects.toThrow(/scorecard/i);
    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT: "10",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: path,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: `sha256:${"b".repeat(64)}`,
    }, temporaryRoot)).rejects.toThrow(/hash/i);
    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT: "10",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: path,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: scorecard.scorecardSha256,
      OPENLEN_FABLE_PARITY_APPROVED_REVISION: SOURCE_REVISION,
    }, temporaryRoot)).rejects.toThrow(/build|attestation|standalone|revision/i);

    const tampered = structuredClone(scorecard);
    tampered.score.passed = false;
    await writeFile(path, JSON.stringify(tampered));
    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT: "10",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: path,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: scorecard.scorecardSha256,
    }, temporaryRoot)).rejects.toThrow(/hash|scorecard/i);
  });

  it("rolls back the configured runtime and verifies disabled is effective while explicit cloning stays reachable", async () => {
    let effectiveMode: "enabled" | "disabled" = "enabled";
    let effectiveRolloutPercent = 50;
    const result = await runFableParityRollbackCli({
      applyTargetMode: async (targetMode: "enabled" | "disabled") => { effectiveMode = targetMode; },
      readEffectiveMode: async () => effectiveMode,
      applyTargetRolloutPercent: async (percent: number) => { effectiveRolloutPercent = percent; },
      readEffectiveRolloutPercent: async () => effectiveRolloutPercent,
      explicitCloneReachable: async () => true,
    } as never);
    expect(result).toMatchObject({
      verified: true,
      effective: { aiCreation: "disabled", rolloutPercent: 0, wholeTemplateFallback: false, explicitTemplateClone: true },
      providerCalls: 0,
    });
  });

  it("rejects a no-op rollback that leaves the configured runtime enabled", async () => {
    await expect(runFableParityRollbackCli({
      applyTargetMode: async () => undefined,
      readEffectiveMode: async () => "enabled",
      applyTargetRolloutPercent: async () => undefined,
      readEffectiveRolloutPercent: async () => 50,
      explicitCloneReachable: async () => true,
    })).rejects.toThrow(/effective|disabled|rollback/i);
  });

  it("drives the configured SSH runtime through atomic disable, process readback, and an authenticated-route reachability probe", async () => {
    const commands: string[] = [];
    const deps = createFableParityProductionRuntimeDeps({
      OPENLEN_HOST: "release-host",
      OPENLEN_REMOTE_PATH: "/opt/openlen-app",
    }, async (host, command) => {
      expect(host).toBe("release-host");
      commands.push(command);
      if (command.includes("sed -n")) return "disabled\n0";
      if (command.includes("/api/projects/from-template")) return "reachable";
      return "";
    });
    await expect(runFableParityRollbackCli(deps)).resolves.toMatchObject({ verified: true, providerCalls: 0 });
    expect(commands).toHaveLength(3);
    expect(commands[0]).toMatch(/mktemp[\s\S]*OPENLEN_AI_CREATION=disabled[\s\S]*OPENLEN_AI_CREATION_ROLLOUT_PERCENT=0[\s\S]*mv -f[\s\S]*systemctl restart[\s\S]*\/proc\/\$pid\/environ/);
    expect(commands[1]).toMatch(/\/proc\/\$pid\/environ[\s\S]*OPENLEN_AI_CREATION=disabled[\s\S]*OPENLEN_AI_CREATION_ROLLOUT_PERCENT=0/);
    expect(commands[2]).toMatch(/curl[\s\S]*\/api\/projects\/from-template[\s\S]*401\|403/);
    expect(commands.join("\n")).not.toMatch(/fireworks|gemini|fable-5|provider/i);
  });

  it("creates missing scorecard parents below scratch and rejects arbitrary output paths", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openlen-fable-score-output-"));
    const scorecard = passingScorecard();
    const nested = join(temporaryRoot, "scratch", "fable-parity", "scorecards", "nested", "scorecard.json");
    await expect(writeFableParityScorecardFile(temporaryRoot, nested, scorecard)).resolves.toBe(nested);
    expect(JSON.parse(await readFile(nested, "utf8"))).toEqual(scorecard);
    await expect(writeFableParityScorecardFile(
      temporaryRoot,
      join(temporaryRoot, "outside-scorecard.json"),
      scorecard,
    )).rejects.toThrow(/scratch|path|evidence/i);
  });

  it("runs deterministic gates before skip-build and verifies or writes build identity before activation", async () => {
    const source = await readFile(join(process.cwd(), "infra", "scripts", "deploy.ps1"), "utf8");
    const deterministic = source.indexOf("generation:fable-parity:gate");
    const activation = source.indexOf("generation:fable-parity:scorecard -- --deploy-gate");
    const skipBuild = source.indexOf('if ($env:OPENLEN_SKIP_BUILD');
    const verifyExisting = source.indexOf("generation:fable-parity:build-attestation -- --verify");
    const writeFresh = source.indexOf("generation:fable-parity:build-attestation -- --write");
    expect(deterministic).toBeGreaterThan(-1);
    expect(skipBuild).toBeGreaterThan(deterministic);
    expect(verifyExisting).toBeGreaterThan(skipBuild);
    expect(writeFresh).toBeGreaterThan(skipBuild);
    expect(activation).toBeGreaterThan(verifyExisting);
    expect(activation).toBeGreaterThan(writeFresh);
    expect(source.slice(skipBuild, activation)).toMatch(/OPENLEN_SKIP_BUILD[\s\S]*--verify[\s\S]*else[\s\S]*--write/i);
  });

  it("registers separate deterministic, live, review, scorecard, and no-provider rollback commands", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining([
      "generation:fable-parity:gate",
      "generation:fable-parity:eval",
      "generation:fable-parity:review",
      "generation:fable-parity:scorecard",
      "generation:fable-parity:build-attestation",
      "generation:fable-parity:rollback",
    ]));
    expect(pkg.scripts["generation:fable-parity:gate"]).toMatch(/^vitest run /);
    expect(pkg.scripts["generation:fable-parity:eval"]).toContain("scripts/fable-parity-eval.ts");
    expect(pkg.scripts["generation:fable-parity:rollback"]).toContain("scripts/fable-parity-rollback.ts");
  });
});
