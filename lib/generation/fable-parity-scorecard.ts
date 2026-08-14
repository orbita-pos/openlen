import { canonicalJsonSha256 } from "./content-hash";

export interface BlindDecision {
  comparisonId: string;
  reviewerSessionId: string;
  desktopPreference: "A" | "tie" | "B";
  mobilePreference: "A" | "tie" | "B";
  overallPreference: "A" | "tie" | "B";
  wrongNicheSide: "none" | "A" | "B" | "both";
  rubric: { niche: number; fidelity: number; polish: number; coherence: number; usability: number };
}

export type FableParityCriticalFailure =
  | "whole_template_clone"
  | "critical_safety"
  | "horizontal_overflow"
  | "unreadable_primary_text"
  | "persistence_credit_atomicity";

export interface FableParityComparisonResult {
  readonly comparisonId: string;
  readonly openLenSide: "A" | "B";
  readonly technicalStatus: "ok" | "openlen_failure" | "fable_failure" | "both_failure";
  readonly openLenEligible: boolean;
  readonly criticalFailures: readonly FableParityCriticalFailure[];
  readonly paidCalls: readonly {
    readonly result: "delivered" | "failed";
    readonly costMicromxn: number;
  }[];
  readonly referencePaidCalls: readonly {
    readonly result: "delivered" | "failed";
    readonly costMicromxn: number;
  }[];
  readonly openLenRequestSha256: string;
  readonly fableRequestSha256: string;
  readonly openLenAttestationSha256: string;
  readonly fableAttestationSha256: string;
}

export interface FableParityScoreInput {
  readonly comparisons: readonly FableParityComparisonResult[];
  readonly decisions: readonly BlindDecision[];
}

export interface FableParityScore {
  comparisons: 20;
  eligibleOpenLenPages: number;
  nonLossRate: number;
  outrightWinRate: number;
  wrongNicheCount: number;
  medianCostMicromxn: number;
  maxCostMicromxn: number;
  passed: boolean;
  failures: readonly string[];
}

export interface SealedFableParityScorecard {
  readonly schemaVersion: "fable-parity-scorecard/2.0";
  readonly evidenceSha256: string;
  readonly source: FableParityScorecardProvenance & {
    artifactManifestSha256: string;
    comparisons: FableParityComparisonResult[];
    decisions: BlindDecision[];
  };
  readonly score: FableParityScore;
  readonly scorecardSha256: string;
}

export interface FableParityScorecardProvenance {
  readonly authorizationManifestSha256: string;
  readonly cohortVersion: string;
  readonly cohortSha256: string;
  readonly sourceRevision: string;
  readonly buildId: string;
  readonly artifactDigest: string;
  readonly immutableRateCardSha256: string;
  readonly rolloutPercent: number;
}

const preferenceValues = new Set(["A", "tie", "B"]);
const wrongNicheValues = new Set(["none", "A", "B", "both"]);
const sha256Hash = /^sha256:[a-f0-9]{64}$/;
const technicalStatuses = new Set(["ok", "openlen_failure", "fable_failure", "both_failure"]);
const criticalFailures = new Set([
  "whole_template_clone",
  "critical_safety",
  "horizontal_overflow",
  "unreadable_primary_text",
  "persistence_credit_atomicity",
]);

function validateComparison(row: FableParityComparisonResult): void {
  if (!row || typeof row !== "object" || !row.comparisonId) throw new Error("comparison ID is required");
  if (!exactKeys(row, ["comparisonId", "openLenSide", "technicalStatus", "openLenEligible", "criticalFailures", "paidCalls", "referencePaidCalls", "openLenRequestSha256", "fableRequestSha256", "openLenAttestationSha256", "fableAttestationSha256"])) {
    throw new Error("comparison evidence must use the strict sealed schema");
  }
  if (row.openLenSide !== "A" && row.openLenSide !== "B") throw new Error("invalid side assignment");
  if (!technicalStatuses.has(row.technicalStatus)) throw new Error("invalid technical status");
  if (typeof row.openLenEligible !== "boolean") throw new Error("eligibility must be boolean");
  if ((row.technicalStatus === "openlen_failure" || row.technicalStatus === "both_failure") && row.openLenEligible) {
    throw new Error("OpenLen failure cannot be eligible");
  }
  if (!Array.isArray(row.criticalFailures) || row.criticalFailures.some((failure) => !criticalFailures.has(failure))) throw new Error("invalid critical release failure");
  for (const ledger of [row.paidCalls, row.referencePaidCalls]) {
    if (!Array.isArray(ledger)) throw new Error("both paid call ledgers are required");
    for (const call of ledger) {
      if (!call || !exactKeys(call, ["result", "costMicromxn"]) || (call.result !== "delivered" && call.result !== "failed")
        || !Number.isSafeInteger(call.costMicromxn) || call.costMicromxn <= 0) {
        throw new Error("invalid paid call ledger entry");
      }
    }
  }
  for (const hash of [row.openLenRequestSha256, row.fableRequestSha256, row.openLenAttestationSha256, row.fableAttestationSha256]) {
    if (!sha256Hash.test(hash)) throw new Error("comparison attestation provenance is required");
  }
  const openLenSucceeded = row.technicalStatus === "ok" || row.technicalStatus === "fable_failure";
  if (openLenSucceeded && row.paidCalls.length === 0) throw new Error("successful OpenLen result requires paid accounting");
  const fableSucceeded = row.technicalStatus === "ok" || row.technicalStatus === "openlen_failure";
  if (fableSucceeded && row.referencePaidCalls.length === 0) throw new Error("successful Fable result requires paid accounting");
}

function validateDecision(row: BlindDecision): void {
  if (!row || typeof row !== "object" || !row.comparisonId || !row.reviewerSessionId) throw new Error("decision identity is required");
  if (![row.desktopPreference, row.mobilePreference, row.overallPreference].every((value) => preferenceValues.has(value))) throw new Error("invalid blind preference");
  if (!wrongNicheValues.has(row.wrongNicheSide)) throw new Error("invalid wrong-niche side");
  const rubric = row.rubric;
  if (!rubric || Object.keys(rubric).sort().join(",") !== "coherence,fidelity,niche,polish,usability"
    || Object.values(rubric).some((value) => !Number.isInteger(value) || value < 1 || value > 10)) {
    throw new Error("rubric scores must be integers from 1 through 10");
  }
}

function validateAndIndex(input: FableParityScoreInput): {
  comparisons: Map<string, FableParityComparisonResult>;
  decisions: Map<string, BlindDecision[]>;
} {
  if (!Array.isArray(input.comparisons) || input.comparisons.length !== 20) throw new Error("scorecard requires exactly 20 comparisons");
  if (!Array.isArray(input.decisions) || input.decisions.length !== 60) throw new Error("scorecard requires exactly three decisions for all 20 comparisons");
  const comparisons = new Map<string, FableParityComparisonResult>();
  for (const row of input.comparisons) {
    validateComparison(row);
    if (comparisons.has(row.comparisonId)) throw new Error("duplicate comparison result");
    comparisons.set(row.comparisonId, row);
  }
  const reviewerIds = new Set<string>();
  const decisionKeys = new Set<string>();
  const decisions = new Map<string, BlindDecision[]>();
  for (const row of input.decisions) {
    validateDecision(row);
    if (!comparisons.has(row.comparisonId)) throw new Error("decision references an unknown comparison");
    const key = `${row.reviewerSessionId}\0${row.comparisonId}`;
    if (decisionKeys.has(key)) throw new Error("duplicate reviewer decision");
    decisionKeys.add(key);
    reviewerIds.add(row.reviewerSessionId);
    decisions.set(row.comparisonId, [...(decisions.get(row.comparisonId) ?? []), row]);
  }
  if (reviewerIds.size !== 3) throw new Error("scorecard requires three independent reviewers");
  for (const comparisonId of comparisons.keys()) {
    const rows = decisions.get(comparisonId) ?? [];
    if (rows.length !== 3 || new Set(rows.map((row) => row.reviewerSessionId)).size !== 3) {
      throw new Error("each comparison requires exactly three independent decisions");
    }
  }
  for (const reviewerId of reviewerIds) {
    if (input.decisions.filter((row) => row.reviewerSessionId === reviewerId).length !== 20) throw new Error("independent reviewer coverage is incomplete");
  }
  return { comparisons, decisions };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return (sorted[9]! + sorted[10]!) / 2;
}

function outcome(
  comparison: FableParityComparisonResult,
  decisions: readonly BlindDecision[],
): "win" | "tie" | "loss" {
  if (comparison.technicalStatus !== "ok") return "loss";
  const openLenVotes = decisions.filter((row) => row.overallPreference === comparison.openLenSide).length;
  const tieVotes = decisions.filter((row) => row.overallPreference === "tie").length;
  if (openLenVotes >= 2) return "win";
  if (tieVotes >= 2) return "tie";
  return "loss";
}

export function scoreFableParity(input: FableParityScoreInput): FableParityScore {
  const indexed = validateAndIndex(input);
  let wins = 0;
  let ties = 0;
  let wrongNicheCount = 0;
  const pageCosts: number[] = [];
  let hasCriticalFailure = false;
  for (const comparison of input.comparisons) {
    const comparisonDecisions = indexed.decisions.get(comparison.comparisonId)!;
    const result = outcome(comparison, comparisonDecisions);
    if (result === "win") wins += 1;
    else if (result === "tie") ties += 1;
    const wrongNicheVotes = comparisonDecisions.filter((row) => (
      row.wrongNicheSide === comparison.openLenSide || row.wrongNicheSide === "both"
    )).length;
    if (wrongNicheVotes >= 2) wrongNicheCount += 1;
    pageCosts.push(comparison.paidCalls.reduce((total, call) => total + call.costMicromxn, 0));
    if (comparison.criticalFailures.length > 0) hasCriticalFailure = true;
  }
  const eligibleOpenLenPages = input.comparisons.filter((row) => row.openLenEligible).length;
  const nonLossRate = (wins + ties) / 20;
  const outrightWinRate = wins / 20;
  const tieRate = ties / 20;
  const medianCostMicromxn = median(pageCosts);
  const maxCostMicromxn = Math.max(...pageCosts);
  const failures: string[] = [];
  if (nonLossRate < 0.7) failures.push("non_loss_rate_below_70_percent");
  if (outrightWinRate < 0.4 && tieRate < 0.8) failures.push("outright_win_rate_below_40_percent");
  if (wrongNicheCount > 0) failures.push("wrong_niche_identity");
  if (eligibleOpenLenPages < 18) failures.push("eligible_openlen_pages_below_90_percent");
  if (hasCriticalFailure) failures.push("critical_release_failure");
  if (medianCostMicromxn > 5_000_000) failures.push("median_cost_above_5_mxn");
  if (maxCostMicromxn >= 10_000_000) failures.push("page_cost_not_below_10_mxn");
  return {
    comparisons: 20,
    eligibleOpenLenPages,
    nonLossRate,
    outrightWinRate,
    wrongNicheCount,
    medianCostMicromxn,
    maxCostMicromxn,
    passed: failures.length === 0,
    failures: Object.freeze(failures),
  };
}

function unsignedScorecard(value: Omit<SealedFableParityScorecard, "scorecardSha256">): Omit<SealedFableParityScorecard, "scorecardSha256"> {
  return value;
}

function normalizedScoreInput(input: FableParityScoreInput): { comparisons: FableParityComparisonResult[]; decisions: BlindDecision[] } {
  validateAndIndex(input);
  const comparisons = input.comparisons.map((row) => ({
    comparisonId: row.comparisonId,
    openLenSide: row.openLenSide,
    technicalStatus: row.technicalStatus,
    openLenEligible: row.openLenEligible,
    criticalFailures: [...row.criticalFailures],
    paidCalls: row.paidCalls.map((call) => ({ result: call.result, costMicromxn: call.costMicromxn })),
    referencePaidCalls: row.referencePaidCalls.map((call) => ({ result: call.result, costMicromxn: call.costMicromxn })),
    openLenRequestSha256: row.openLenRequestSha256,
    fableRequestSha256: row.fableRequestSha256,
    openLenAttestationSha256: row.openLenAttestationSha256,
    fableAttestationSha256: row.fableAttestationSha256,
  })).sort((left, right) => left.comparisonId.localeCompare(right.comparisonId));
  const decisions = input.decisions.map((row) => ({
    comparisonId: row.comparisonId,
    reviewerSessionId: row.reviewerSessionId,
    desktopPreference: row.desktopPreference,
    mobilePreference: row.mobilePreference,
    overallPreference: row.overallPreference,
    wrongNicheSide: row.wrongNicheSide,
    rubric: { ...row.rubric },
  })).sort((left, right) => (
    left.comparisonId.localeCompare(right.comparisonId) || left.reviewerSessionId.localeCompare(right.reviewerSessionId)
  ));
  return { comparisons, decisions };
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validateProvenance(value: FableParityScorecardProvenance): void {
  if (!value || typeof value !== "object"
    || !exactKeys(value, ["authorizationManifestSha256", "cohortVersion", "cohortSha256", "sourceRevision", "buildId", "artifactDigest", "immutableRateCardSha256", "rolloutPercent"])
    || ![value.authorizationManifestSha256, value.cohortSha256, value.artifactDigest, value.immutableRateCardSha256].every((hash) => sha256Hash.test(hash))
    || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.sourceRevision)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/.test(value.buildId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/.test(value.cohortVersion)
    || !Number.isInteger(value.rolloutPercent) || value.rolloutPercent < 1 || value.rolloutPercent > 99) {
    throw new Error("invalid scorecard release provenance");
  }
}

export function sealFableParityScorecard(
  input: FableParityScoreInput,
  artifactManifestSha256: string,
  provenance: FableParityScorecardProvenance,
): SealedFableParityScorecard {
  if (!sha256Hash.test(artifactManifestSha256)) throw new Error("artifact manifest hash is required");
  validateProvenance(provenance);
  const normalized = normalizedScoreInput(input);
  const source = { ...structuredClone(provenance), artifactManifestSha256, ...normalized };
  const unsigned = unsignedScorecard({
    schemaVersion: "fable-parity-scorecard/2.0",
    evidenceSha256: canonicalJsonSha256(source),
    source,
    score: scoreFableParity(normalized),
  });
  return Object.freeze({ ...unsigned, scorecardSha256: canonicalJsonSha256(unsigned) });
}

export function verifyFableParityScorecard(value: unknown): FableParityScore {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid scorecard manifest");
  const manifest = value as SealedFableParityScorecard;
  if (!exactKeys(manifest, ["schemaVersion", "evidenceSha256", "source", "score", "scorecardSha256"])
    || manifest.schemaVersion !== "fable-parity-scorecard/2.0"
    || !/^sha256:[a-f0-9]{64}$/.test(manifest.evidenceSha256 ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(manifest.scorecardSha256 ?? "")) {
    throw new Error("invalid immutable scorecard manifest");
  }
  if (!manifest.source || typeof manifest.source !== "object"
    || !exactKeys(manifest.source, ["authorizationManifestSha256", "cohortVersion", "cohortSha256", "sourceRevision", "buildId", "artifactDigest", "immutableRateCardSha256", "rolloutPercent", "artifactManifestSha256", "comparisons", "decisions"])
    || !sha256Hash.test(manifest.source.artifactManifestSha256 ?? "")) {
    throw new Error("invalid scorecard source evidence");
  }
  const provenance: FableParityScorecardProvenance = {
    authorizationManifestSha256: manifest.source.authorizationManifestSha256,
    cohortVersion: manifest.source.cohortVersion,
    cohortSha256: manifest.source.cohortSha256,
    sourceRevision: manifest.source.sourceRevision,
    buildId: manifest.source.buildId,
    artifactDigest: manifest.source.artifactDigest,
    immutableRateCardSha256: manifest.source.immutableRateCardSha256,
    rolloutPercent: manifest.source.rolloutPercent,
  };
  validateProvenance(provenance);
  const normalized = normalizedScoreInput(manifest.source);
  const normalizedSource = {
    ...provenance,
    artifactManifestSha256: manifest.source.artifactManifestSha256,
    ...normalized,
  };
  if (canonicalJsonSha256(normalizedSource) !== manifest.evidenceSha256) throw new Error("scorecard source evidence hash mismatch");
  const recomputedScore = scoreFableParity(normalized);
  if (canonicalJsonSha256(recomputedScore) !== canonicalJsonSha256(manifest.score)) {
    throw new Error("scorecard score does not match recomputed source evidence");
  }
  const { scorecardSha256, ...unsigned } = manifest;
  if (canonicalJsonSha256(unsigned) !== scorecardSha256) throw new Error("scorecard hash mismatch");
  return structuredClone(recomputedScore);
}
