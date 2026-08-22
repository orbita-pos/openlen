import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { validateGeneratedImage } from "./asset-image-validation";
import { canonicalJsonSha256 } from "./content-hash";

const Sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Identity = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/);
const Revision = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const PositiveSafeInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const NonNegativeSafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ByteArray = z.custom<Uint8Array>((value) => (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) && (value as Uint8Array).byteLength > 0);

const AdapterSchema = z.object({
  adapterId: Identity,
  endpointSha256: Sha256,
  modelIds: z.array(Identity).min(1).max(8),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.modelIds).size !== value.modelIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "adapter model IDs must be unique" });
});

export const FableParityEvalAuthorizationManifestSchema = z.object({
  schemaVersion: z.literal("fable-parity-eval-authorization/2.0"),
  oneTimeTokenSha256: Sha256,
  cohort: z.object({ version: Identity, sha256: Sha256 }).strict(),
  source: z.object({ revision: Revision, buildId: Identity, artifactDigest: Sha256 }).strict(),
  rolloutPercent: z.number().int().min(1).max(99),
  adapters: z.object({ openlen: AdapterSchema, fable: AdapterSchema }).strict(),
  immutableRateCardSha256: Sha256,
  caps: z.object({
    comparisonCount: z.literal(20),
    openLenPageMicromxn: z.literal(10_000_000),
    fablePageMicromxn: PositiveSafeInteger,
    aggregateMicromxn: PositiveSafeInteger,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const theoretical = value.caps.comparisonCount * (value.caps.openLenPageMicromxn + value.caps.fablePageMicromxn);
  if (!Number.isSafeInteger(theoretical) || value.caps.aggregateMicromxn !== theoretical) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["caps", "aggregateMicromxn"], message: "aggregate cap must equal the authorized theoretical maximum" });
  }
});

export type FableParityEvalAuthorizationManifest = z.infer<typeof FableParityEvalAuthorizationManifestSchema>;
export type FableParityEvalSide = "openlen" | "fable";

export interface FableParityEvaluatorRequest {
  readonly schemaVersion: "fable-parity-evaluator-request/1.0";
  readonly manifestSha256: string;
  readonly comparisonId: string;
  readonly ordinal: number;
  readonly promptSha256: string;
  readonly side: FableParityEvalSide;
  readonly adapterId: string;
  readonly endpointSha256: string;
  readonly modelIds: readonly string[];
  readonly sourceRevision: string;
  readonly buildId: string;
  readonly artifactDigest: string;
  readonly immutableRateCardSha256: string;
  readonly rolloutPercent: number;
  readonly pageCapMicromxn: number;
  readonly aggregateRemainingBeforeMicromxn: number;
  readonly reservedMicromxn: number;
  readonly aggregateRemainingAfterReservationMicromxn: number;
  readonly sequence: number;
  readonly requestSha256: string;
}

const ScreenshotSchema = z.object({
  bytes: ByteArray,
  mimeType: z.literal("image/jpeg"),
  fullPage: z.literal(true),
  viewport: z.object({ width: PositiveSafeInteger, height: PositiveSafeInteger }).strict(),
  contentHeight: PositiveSafeInteger,
}).strict();
const PaidCallSchema = z.object({ result: z.enum(["delivered", "failed"]), costMicromxn: PositiveSafeInteger }).strict();
const ResultSchema = z.object({
  htmlBytes: ByteArray,
  desktop: ScreenshotSchema,
  mobile: ScreenshotSchema,
  costMicromxn: NonNegativeSafeInteger,
  technicalStatus: z.enum(["ok", "failed"]),
  eligible: z.boolean(),
  criticalFailures: z.array(z.enum(["whole_template_clone", "critical_safety", "horizontal_overflow", "unreadable_primary_text", "persistence_credit_atomicity"])).max(5),
  paidCalls: z.array(PaidCallSchema).max(64),
  manifestSha256: Sha256,
  requestSha256: Sha256,
  side: z.enum(["openlen", "fable"]),
  adapterId: Identity,
  endpointSha256: Sha256,
  modelIds: z.array(Identity).min(1).max(8),
  sourceRevision: Revision,
  buildId: Identity,
  artifactDigest: Sha256,
  immutableRateCardSha256: Sha256,
  rolloutPercent: z.number().int().min(1).max(99),
}).strict();

export type FableParityEvaluatorResult = z.infer<typeof ResultSchema>;

const AttestationSchema = z.object({
  schemaVersion: z.literal("fable-parity-eval-attestation/1.0"),
  algorithm: z.literal("HMAC-SHA256"),
  keyId: Identity,
  signedPayloadSha256: Sha256,
  signatureBase64Url: z.string().min(43).max(44).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export interface FableParityAttestedEvaluatorResponse {
  readonly result: FableParityEvaluatorResult;
  readonly attestation: z.infer<typeof AttestationSchema>;
}

export interface FableParityAttestationVerifierInput {
  readonly keyId: string;
  readonly algorithm: "HMAC-SHA256";
  readonly signedPayloadSha256: string;
  readonly signatureBase64Url: string;
}

export type FableParityAttestationVerifier = (input: FableParityAttestationVerifierInput) => boolean | Promise<boolean>;

export function hashFableParityAuthorizationToken(token: string): string {
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function validateFableParityAuthorizationManifest(value: unknown): FableParityEvalAuthorizationManifest {
  return FableParityEvalAuthorizationManifestSchema.parse(value);
}

export function fableParityAuthorizationManifestSha256(manifest: FableParityEvalAuthorizationManifest): string {
  return canonicalJsonSha256(validateFableParityAuthorizationManifest(manifest));
}

export function createFableParityEvaluatorRequest(input: {
  readonly manifest: FableParityEvalAuthorizationManifest;
  readonly manifestSha256: string;
  readonly comparisonId: string;
  readonly ordinal: number;
  readonly promptSha256: string;
  readonly side: FableParityEvalSide;
  readonly sequence: number;
  readonly aggregateRemainingBeforeMicromxn: number;
  readonly aggregateRemainingAfterReservationMicromxn: number;
}): FableParityEvaluatorRequest {
  const manifest = validateFableParityAuthorizationManifest(input.manifest);
  if (fableParityAuthorizationManifestSha256(manifest) !== input.manifestSha256) throw new Error("authorization manifest hash mismatch");
  const adapter = manifest.adapters[input.side];
  const pageCapMicromxn = input.side === "openlen" ? manifest.caps.openLenPageMicromxn : manifest.caps.fablePageMicromxn;
  const unsigned = {
    schemaVersion: "fable-parity-evaluator-request/1.0" as const,
    manifestSha256: input.manifestSha256,
    comparisonId: input.comparisonId,
    ordinal: input.ordinal,
    promptSha256: input.promptSha256,
    side: input.side,
    adapterId: adapter.adapterId,
    endpointSha256: adapter.endpointSha256,
    modelIds: [...adapter.modelIds],
    sourceRevision: manifest.source.revision,
    buildId: manifest.source.buildId,
    artifactDigest: manifest.source.artifactDigest,
    immutableRateCardSha256: manifest.immutableRateCardSha256,
    rolloutPercent: manifest.rolloutPercent,
    pageCapMicromxn,
    aggregateRemainingBeforeMicromxn: input.aggregateRemainingBeforeMicromxn,
    reservedMicromxn: pageCapMicromxn,
    aggregateRemainingAfterReservationMicromxn: input.aggregateRemainingAfterReservationMicromxn,
    sequence: input.sequence,
  };
  return Object.freeze({ ...unsigned, requestSha256: canonicalJsonSha256(unsigned) });
}

async function validateScreenshot(value: z.infer<typeof ScreenshotSchema>, label: string): Promise<void> {
  if (value.contentHeight <= value.viewport.height) throw new Error(`${label} is viewport-only, not full-page`);
  const decoded = await validateGeneratedImage(value.bytes, value.mimeType).catch(() => { throw new Error(`${label} image decode failed`); });
  if (decoded.width !== value.viewport.width || decoded.height !== value.contentHeight) throw new Error(`${label} decoded dimensions mismatch`);
}

export async function verifyFableParityAttestedResponse(
  request: FableParityEvaluatorRequest,
  response: unknown,
  verifyAttestation: FableParityAttestationVerifier,
): Promise<FableParityEvaluatorResult> {
  const envelope = z.object({ result: ResultSchema, attestation: AttestationSchema }).strict().parse(response);
  const result = envelope.result;
  const { requestSha256: _requestSha256, ...unsignedRequest } = request;
  if (canonicalJsonSha256(unsignedRequest) !== request.requestSha256) {
    throw new Error("evaluator request hash mismatch");
  }
  for (const key of ["manifestSha256", "requestSha256", "side", "adapterId", "endpointSha256", "sourceRevision", "buildId", "artifactDigest", "immutableRateCardSha256", "rolloutPercent"] as const) {
    if (result[key] !== request[key]) throw new Error(`${key} attestation provenance mismatch`);
  }
  if (JSON.stringify(result.modelIds) !== JSON.stringify(request.modelIds)) throw new Error("model attestation provenance mismatch");
  if (result.costMicromxn > request.pageCapMicromxn) throw new Error("attested result exceeded page cap");
  if (result.technicalStatus === "failed" && result.eligible) throw new Error("failed attested result cannot be eligible");
  if (new Set(result.criticalFailures).size !== result.criticalFailures.length) throw new Error("critical failure ledger is duplicated");
  const ledgerCost = result.paidCalls.reduce((sum, call) => sum + call.costMicromxn, 0);
  if (!Number.isSafeInteger(ledgerCost) || ledgerCost !== result.costMicromxn) throw new Error("fabricated paid ledger cost");
  if (result.technicalStatus === "ok" && (result.paidCalls.length === 0 || ledgerCost === 0)) throw new Error("delivered result requires positive paid ledger");
  if (result.technicalStatus === "failed" && !result.eligible && ledgerCost === 0 && result.paidCalls.length !== 0) throw new Error("zero-cost failure ledger must be empty");
  await validateScreenshot(result.desktop, `${request.side} desktop`);
  await validateScreenshot(result.mobile, `${request.side} mobile`);
  const signedPayloadSha256 = canonicalJsonSha256({ request, result });
  if (envelope.attestation.signedPayloadSha256 !== signedPayloadSha256) throw new Error("attestation signed payload mismatch");
  if (!(await verifyAttestation(envelope.attestation))) throw new Error("attestation signature rejected");
  return structuredClone(result);
}

export function createHmacFableParityAttestationVerifier(secret: Uint8Array, expectedKeyId: string): FableParityAttestationVerifier {
  const key = Buffer.from(secret);
  if (key.byteLength < 32 || !Identity.safeParse(expectedKeyId).success) throw new Error("attestation verifier configuration is invalid");
  return ({ keyId, algorithm, signedPayloadSha256, signatureBase64Url }) => {
    if (keyId !== expectedKeyId || algorithm !== "HMAC-SHA256" || !Sha256.safeParse(signedPayloadSha256).success) return false;
    let actual: Buffer;
    try { actual = Buffer.from(signatureBase64Url, "base64url"); } catch { return false; }
    const expected = createHmac("sha256", key).update(signedPayloadSha256).digest();
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  };
}

export interface FableParityAggregateReservation {
  readonly sequence: number;
  readonly side: FableParityEvalSide;
  readonly pageCapMicromxn: number;
  readonly aggregateRemainingBeforeMicromxn: number;
  readonly aggregateRemainingAfterReservationMicromxn: number;
}

export function createFableParityAggregateBudget(manifest: FableParityEvalAuthorizationManifest) {
  const validated = validateFableParityAuthorizationManifest(manifest);
  const plannedSides = Array.from({ length: 20 }, () => ["openlen", "fable"] as const).flat();
  let next = 0;
  let settledMicromxn = 0;
  let reservedMicromxn = 0;
  const open = new Set<number>();
  return {
    reserve(side: FableParityEvalSide): FableParityAggregateReservation {
      if (next >= plannedSides.length || plannedSides[next] !== side) throw new Error("no extra evaluator call is authorized");
      const pageCapMicromxn = side === "openlen" ? validated.caps.openLenPageMicromxn : validated.caps.fablePageMicromxn;
      const before = validated.caps.aggregateMicromxn - settledMicromxn - reservedMicromxn;
      if (pageCapMicromxn > before) throw new Error("aggregate evaluation budget exceeded before call");
      next += 1;
      reservedMicromxn += pageCapMicromxn;
      open.add(next);
      return { sequence: next, side, pageCapMicromxn, aggregateRemainingBeforeMicromxn: before, aggregateRemainingAfterReservationMicromxn: before - pageCapMicromxn };
    },
    settle(reservation: FableParityAggregateReservation, exactCostMicromxn: number): void {
      if (!open.delete(reservation.sequence)) throw new Error("unknown or settled evaluation reservation");
      if (!Number.isSafeInteger(exactCostMicromxn) || exactCostMicromxn < 0 || exactCostMicromxn > reservation.pageCapMicromxn) throw new Error("evaluation settlement exceeds reservation");
      reservedMicromxn -= reservation.pageCapMicromxn;
      settledMicromxn += exactCostMicromxn;
      if (settledMicromxn + reservedMicromxn > validated.caps.aggregateMicromxn) throw new Error("aggregate evaluation budget overspend");
    },
    assertComplete(): void {
      if (next !== plannedSides.length || open.size !== 0) throw new Error("evaluation reservations are incomplete");
    },
    snapshot: () => ({ settledMicromxn, reservedMicromxn, calls: next, capMicromxn: validated.caps.aggregateMicromxn }),
  };
}
