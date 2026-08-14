import { createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { FABLE_MODEL_POLICY } from "@/lib/generation/fable-model-policy";
import {
  buildFableParityCohort,
  type FableParityCohortRow,
  type FableParityPrompt,
  type SealedHiddenRecord,
} from "@/lib/generation/fable-parity-cohort";
import {
  writeBlindArtifactBundle,
  type BlindComparisonArtifactsInput,
} from "@/lib/generation/fable-parity-review-session";

export const FABLE_PARITY_EVAL_AUTHORIZATION = "AUTHORIZED_FABLE_PARITY_EVAL_ONCE";

type Environment = Readonly<Record<string, string | undefined>>;

interface EvaluationSideResult {
  readonly htmlBytes: Uint8Array;
  readonly desktop: { readonly bytes: Uint8Array; readonly fullPage: true; readonly viewport: { readonly width: number; readonly height: number } };
  readonly mobile: { readonly bytes: Uint8Array; readonly fullPage: true; readonly viewport: { readonly width: number; readonly height: number } };
  readonly costMicromxn: number;
  readonly technicalStatus: "ok" | "failed";
  readonly eligible: boolean;
  readonly criticalFailures: readonly ("whole_template_clone" | "critical_safety" | "horizontal_overflow" | "unreadable_primary_text" | "persistence_credit_atomicity")[];
  readonly paidCalls: readonly { readonly result: "delivered" | "failed"; readonly costMicromxn: number }[];
}

export interface FableParityEvalCliDeps {
  readonly env: Environment;
  readonly loadSealedRecords: () => Promise<readonly SealedHiddenRecord[]>;
  readonly decryptHiddenRecord: (record: SealedHiddenRecord, index: number) => Promise<unknown>;
  readonly consumeAuthorization: () => Promise<void>;
  readonly generateOpenLen: (row: FableParityCohortRow) => Promise<EvaluationSideResult>;
  readonly generateFable: (row: FableParityCohortRow) => Promise<EvaluationSideResult>;
  readonly writeBundle: (input: {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly comparisons: readonly BlindComparisonArtifactsInput[];
  }) => Promise<{ readonly manifestPath: string; readonly manifestSha256: string }>;
  readonly randomRunId: () => string;
  readonly workspaceRoot?: string;
}

interface EvalConfig {
  readonly totalCapMicromxn: number;
  readonly pageCapMicromxn: 10_000_000;
  readonly referencePageCapMicromxn: number;
}

function positiveSafeInteger(env: Environment, name: string): number {
  const value = Number(env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function reviewedModel(env: Environment, key: string, expected: string): void {
  if (env[key] !== expected) throw new Error(`${key} is not the reviewed model`);
}

export function validateFableParityEvalEnvironment(env: Environment): EvalConfig {
  if (env.OPENLEN_FABLE_PARITY_LIVE !== "1") throw new Error("live evaluation gate is closed");
  if (env.OPENLEN_FABLE_PARITY_AUTHORIZATION !== FABLE_PARITY_EVAL_AUTHORIZATION) throw new Error("one-time authorization is invalid");
  const pageCapMicromxn = positiveSafeInteger(env, "OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN");
  if (pageCapMicromxn !== 10_000_000) throw new Error("OpenLen page cap must be exactly 10 MXN");
  const referencePageCapMicromxn = positiveSafeInteger(env, "OPENLEN_FABLE_PARITY_REFERENCE_PAGE_CAP_MICROMXN");
  const totalCapMicromxn = positiveSafeInteger(env, "OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN");
  const authorizedMaximum = 20 * (pageCapMicromxn + referencePageCapMicromxn);
  if (totalCapMicromxn < authorizedMaximum) throw new Error("total cap cannot reserve all 20 sequential comparisons");
  reviewedModel(env, "OPENLEN_FABLE_PARITY_REASONER_MODEL", FABLE_MODEL_POLICY.reasoner.modelId);
  reviewedModel(env, "OPENLEN_FABLE_PARITY_DESIGNER_MODEL", FABLE_MODEL_POLICY.designer.modelId);
  reviewedModel(env, "OPENLEN_FABLE_PARITY_CRITIC_MODEL", FABLE_MODEL_POLICY.visualCritic.modelId);
  reviewedModel(env, "OPENLEN_FABLE_PARITY_IMAGE_MODEL", "gemini-2.5-flash-image");
  reviewedModel(env, "OPENLEN_FABLE_PARITY_REFERENCE_MODEL", "fable-5");
  const actualRateCard = env.OPENLEN_FABLE_PARITY_RATE_CARD_SHA256;
  const reviewedRateCard = env.OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256;
  if (!actualRateCard || !/^sha256:[a-f0-9]{64}$/.test(actualRateCard) || actualRateCard !== reviewedRateCard) {
    throw new Error("reviewed rate card hash is missing or stale");
  }
  return { totalCapMicromxn, pageCapMicromxn, referencePageCapMicromxn };
}

function validateSideResult(result: EvaluationSideResult, capMicromxn: number, label: string): void {
  const bytes = (value: Uint8Array | undefined) => value !== undefined && (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) && value.byteLength > 0;
  if (!result || !bytes(result.htmlBytes)
    || result.desktop?.fullPage !== true || !bytes(result.desktop.bytes)
    || result.mobile?.fullPage !== true || !bytes(result.mobile.bytes)) {
    throw new Error(`${label} did not return complete full-page artifacts`);
  }
  for (const screenshot of [result.desktop, result.mobile]) {
    if (!Number.isSafeInteger(screenshot.viewport?.width) || screenshot.viewport.width <= 0
      || !Number.isSafeInteger(screenshot.viewport?.height) || screenshot.viewport.height <= 0) {
      throw new Error(`${label} viewport is invalid`);
    }
  }
  if (result.technicalStatus !== "ok" && result.technicalStatus !== "failed") throw new Error(`${label} technical status is invalid`);
  if (typeof result.eligible !== "boolean" || (result.technicalStatus === "failed" && result.eligible)) {
    throw new Error(`${label} eligibility contradicts technical status`);
  }
  const allowedCriticalFailures = new Set([
    "whole_template_clone",
    "critical_safety",
    "horizontal_overflow",
    "unreadable_primary_text",
    "persistence_credit_atomicity",
  ]);
  if (!Array.isArray(result.criticalFailures)
    || result.criticalFailures.some((failure) => !allowedCriticalFailures.has(failure))
    || new Set(result.criticalFailures).size !== result.criticalFailures.length) {
    throw new Error(`${label} critical failure ledger is invalid`);
  }
  if (!Number.isSafeInteger(result.costMicromxn) || result.costMicromxn < 0 || result.costMicromxn > capMicromxn) throw new Error(`${label} exceeded its page cap`);
  if (!Array.isArray(result.paidCalls)) throw new Error(`${label} paid-call ledger is invalid`);
  const ledgerCost = result.paidCalls.reduce((total, call) => {
    if (!call || (call.result !== "delivered" && call.result !== "failed")
      || !Number.isSafeInteger(call.costMicromxn) || call.costMicromxn <= 0
      || !Number.isSafeInteger(total + call.costMicromxn)) throw new Error(`${label} paid-call ledger is invalid`);
    return total + call.costMicromxn;
  }, 0);
  if (ledgerCost !== result.costMicromxn) throw new Error(`${label} paid failures are not fully represented in cost`);
  if (result.technicalStatus === "ok" && (result.paidCalls.length === 0 || ledgerCost === 0)) {
    throw new Error(`${label} successful result requires non-zero paid accounting`);
  }
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
  | { readonly ok: true; readonly comparisons: 20; readonly openLenCalls: 20; readonly fableCalls: 20; readonly manifestPath: string; readonly manifestSha256: string; readonly authorizedMaximumMicromxn: number }
> {
  let config: EvalConfig;
  try {
    config = validateFableParityEvalEnvironment(deps.env);
  } catch {
    return { ok: false, code: "closed" };
  }
  try {
    await deps.consumeAuthorization();
  } catch {
    return { ok: false, code: "closed" };
  }
  const cohort = await buildFableParityCohort(await deps.loadSealedRecords(), deps.decryptHiddenRecord);
  const comparisons: BlindComparisonArtifactsInput[] = [];
  let openLenCalls = 0;
  let fableCalls = 0;
  for (const row of cohort) {
    const openLen = await deps.generateOpenLen(row);
    openLenCalls += 1;
    validateSideResult(openLen, config.pageCapMicromxn, "OpenLen");
    const fable = await deps.generateFable(row);
    fableCalls += 1;
    validateSideResult(fable, config.referencePageCapMicromxn, "Fable");
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
        paidCalls: openLen.paidCalls,
      })),
    });
  }
  if (openLenCalls !== 20 || fableCalls !== 20) throw new Error("evaluation call count invariant failed");
  const written = await deps.writeBundle({
    workspaceRoot: deps.workspaceRoot ?? process.cwd(),
    runId: deps.randomRunId(),
    comparisons,
  });
  return {
    ok: true,
    comparisons: 20,
    openLenCalls: 20,
    fableCalls: 20,
    manifestPath: written.manifestPath,
    manifestSha256: written.manifestSha256,
    authorizedMaximumMicromxn: config.totalCapMicromxn,
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

async function endpointResult(endpoint: string, token: string, row: FableParityCohortRow): Promise<EvaluationSideResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ comparisonId: row.comparisonId, prompt: row.prompt.prompt }),
  });
  if (!response.ok) throw new Error("evaluation endpoint failed");
  const body = await response.json() as Record<string, unknown>;
  const screenshot = (name: "desktop" | "mobile") => {
    const value = body[name] as Record<string, unknown>;
    return {
      bytes: Buffer.from(String(value?.screenshotBase64 ?? ""), "base64"),
      fullPage: value?.fullPage as true,
      viewport: value?.viewport as { width: number; height: number },
    };
  };
  return {
    htmlBytes: Buffer.from(String(body.html ?? ""), "utf8"),
    desktop: screenshot("desktop"),
    mobile: screenshot("mobile"),
    costMicromxn: Number(body.costMicromxn),
    technicalStatus: body.technicalStatus as "ok" | "failed",
    eligible: body.eligible === true,
    criticalFailures: body.criticalFailures as EvaluationSideResult["criticalFailures"],
    paidCalls: body.paidCalls as EvaluationSideResult["paidCalls"],
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const hiddenPath = required(env, "OPENLEN_FABLE_PARITY_HIDDEN_COHORT_PATH");
  const openLenEndpoint = required(env, "OPENLEN_FABLE_PARITY_OPENLEN_ENDPOINT");
  const openLenToken = required(env, "OPENLEN_FABLE_PARITY_OPENLEN_TOKEN");
  const fableEndpoint = required(env, "OPENLEN_FABLE_PARITY_REFERENCE_ENDPOINT");
  const fableToken = required(env, "OPENLEN_FABLE_PARITY_REFERENCE_TOKEN");
  const result = await runFableParityEvalCli({
    env,
    loadSealedRecords: async () => JSON.parse(await readFile(hiddenPath, "utf8")) as SealedHiddenRecord[],
    decryptHiddenRecord: aesDecryptor(env),
    consumeAuthorization: async () => {
      const marker = join(process.cwd(), "scratch", "fable-parity", "authorizations", `${FABLE_PARITY_EVAL_AUTHORIZATION}.consumed`);
      await mkdir(dirname(marker), { recursive: true });
      await writeFile(marker, new Date().toISOString(), { flag: "wx" });
    },
    generateOpenLen: (row) => endpointResult(openLenEndpoint, openLenToken, row),
    generateFable: (row) => endpointResult(fableEndpoint, fableToken, row),
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
