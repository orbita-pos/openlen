import { createHash } from "node:crypto";
import type { SelectorEvalCase } from "./selector-cases";
import type { CritiqueVerdict } from "@/lib/ai/vision-critique";
import type { CompleteVisualEnginePilotRunOutcome } from "./visual-engine-pilot-store";
import { pickWeighted } from "@/lib/curate/pick-template";

export const VISUAL_ENGINE_2A_PILOT_SIZE = 75;
export const VISUAL_ENGINE_2A_COST_LIMIT_MICROMXN = 400_000;
export const VISUAL_ENGINE_2A_ROLLBACK_FIXTURE = Object.freeze({
  brief: "Visual Engine 2A rollback fixture",
  weightedTemplateId: "rollback-weighted",
  skeletonTemplateId: "rollback-skeleton",
  normalizedHtml: "<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Rollback fixture</h1></main></body></html>",
});

export const VISUAL_ENGINE_2A_SCENARIOS = [
  { id: "accessible-generous-spacing", suffix: "Use accessible contrast and generous spacing." },
  { id: "anti-generic", suffix: "Avoid generic styling and express the requested domain visually." },
  { id: "identity-before-copy", suffix: "The identity must remain recognizable when visible copy is neutralized." },
  { id: "plain", suffix: "" },
  { id: "saved-brand-accent", suffix: "Respect the saved brand accent #E85D9E." },
] as const;

export interface VisualEngine2APoolRow {
  caseId: string;
  scenarioId: string;
  language: "es" | "en";
  brief: string;
  forbiddenSignals: string[];
}

export function buildVisualEngine2APool(cases: readonly SelectorEvalCase[]): VisualEngine2APoolRow[] {
  const rows = cases.flatMap((item) => VISUAL_ENGINE_2A_SCENARIOS.map((scenario) => ({
    caseId: item.id,
    scenarioId: scenario.id,
    language: item.language,
    brief: scenario.suffix ? `${item.brief}\n\n${scenario.suffix}` : item.brief,
    forbiddenSignals: [...item.forbiddenSignals],
  })));
  return rows.sort((left, right) =>
    left.caseId.localeCompare(right.caseId) || left.scenarioId.localeCompare(right.scenarioId));
}

export type PilotPreflightSelection =
  | { ok: true; route: "template_full" | "template_skeleton" | "section_composition" | "safe_failure" | "scratch_controlled"; templateId: string }
  | { ok: false; errorKind: string };

export interface PilotPreflightCounts {
  pool: number;
  analyzed: number;
  selectionFailures: number;
  templateSkeleton: number;
  templateFull: number;
  sectionComposition: number;
  safeFailure: number;
  scratchControlled: number;
}

export async function preflightVisualEngine2A(args: {
  cases: readonly SelectorEvalCase[];
  templates: readonly unknown[];
  select: (
    brief: string,
    templates: readonly unknown[],
    row: VisualEngine2APoolRow,
  ) => Promise<PilotPreflightSelection>;
  /** Accepted for callers that share pilot dependencies; never invoked in preflight. */
  reserve?: (...args: never[]) => unknown;
}): Promise<
  | { ok: true; eligible: Array<VisualEngine2APoolRow & { templateId: string }>; counts: PilotPreflightCounts }
  | { ok: false; code: "insufficient_eligible_cases"; counts: PilotPreflightCounts }
> {
  const pool = buildVisualEngine2APool(args.cases);
  const counts: PilotPreflightCounts = {
    pool: pool.length, analyzed: 0, selectionFailures: 0,
    templateSkeleton: 0, templateFull: 0, sectionComposition: 0, safeFailure: 0, scratchControlled: 0,
  };
  const eligible: Array<VisualEngine2APoolRow & { templateId: string }> = [];
  for (const row of pool) {
    const result = await args.select(row.brief, args.templates, row);
    counts.analyzed += 1;
    if (!result.ok) {
      counts.selectionFailures += 1;
      continue;
    }
    if (result.route === "template_skeleton") {
      counts.templateSkeleton += 1;
      eligible.push({ ...row, templateId: result.templateId });
    } else if (result.route === "template_full") counts.templateFull += 1;
    else if (result.route === "section_composition") counts.sectionComposition += 1;
    else if (result.route === "safe_failure") counts.safeFailure += 1;
    else counts.scratchControlled += 1;
  }
  if (eligible.length < VISUAL_ENGINE_2A_PILOT_SIZE) {
    return { ok: false, code: "insufficient_eligible_cases", counts };
  }
  return { ok: true, eligible: eligible.slice(0, VISUAL_ENGINE_2A_PILOT_SIZE), counts };
}

/** Reproduces Quick's ranked weighted baseline while keeping the safe route only for the candidate. */
export async function prepareVisualEngine2ABuilds<TCopy, TBuild>(args: {
  rankedTemplateIds: string[];
  safeTemplateId: string;
  copy: TCopy;
  random?: () => number;
  fill(templateId: string, copy: TCopy): Promise<TBuild>;
}): Promise<{
  baselineTemplateId: string;
  candidateTemplateId: string;
  baselineBuild: TBuild;
  candidateBuild: TBuild;
}> {
  const baselineTemplateId = pickWeighted(args.rankedTemplateIds, args.random);
  if (!baselineTemplateId) throw new Error("Quick returned no weighted template");
  const candidateTemplateId = args.safeTemplateId;
  const [baselineBuild, candidateBuild] = await Promise.all([
    args.fill(baselineTemplateId, args.copy),
    args.fill(candidateTemplateId, args.copy),
  ]);
  return { baselineTemplateId, candidateTemplateId, baselineBuild, candidateBuild };
}

export type PilotReviewVerdict = "candidate" | "baseline" | "tie" | "invalid";
export interface VisualEngine2AScoreRow {
  started: boolean;
  technicalSuccess: boolean;
  /** Null until a reviewer records a decision. */
  verdict: PilotReviewVerdict | null;
  structuralFailure: boolean;
  partialPersistenceFailure: boolean;
  acceptedForbiddenSignals: number;
  productionEquivalentCostMicromxn: number;
}

export interface VisualEngine2AScorecard {
  started: number;
  technicalSuccesses: number;
  technicalFailures: number;
  technicalSuccessRate: number;
  reviewed: number;
  expectedReviews: number;
  unreviewed: number;
  invalidReviews: number;
  comparable: number;
  candidateWins: number;
  requiredVisualWins: number;
  visuallyPreferredRate: number;
  structuralFailures: number;
  partialPersistenceFailures: number;
  acceptedForbiddenSignals: number;
  meanProductionEquivalentCostMicromxn: number;
  rollbackVerified: boolean;
  failures: string[];
  passed: boolean;
}

export function scoreVisualEngine2APilot(
  rows: readonly VisualEngine2AScoreRow[],
  rollback: { verified: boolean },
): VisualEngine2AScorecard {
  const startedRows = rows.filter((row) => row.started);
  const technicalSuccesses = startedRows.filter((row) => row.technicalSuccess).length;
  const technicalFailures = startedRows.length - technicalSuccesses;
  const expectedReviews = technicalSuccesses;
  const reviewedRows = startedRows.filter((row) => row.technicalSuccess && row.verdict !== null);
  const unreviewed = expectedReviews - reviewedRows.length;
  const invalidReviews = startedRows.filter((row) => row.verdict === "invalid").length;
  const comparableRows = reviewedRows.filter(
    (row) => row.verdict === "candidate" || row.verdict === "baseline" || row.verdict === "tie",
  );
  const candidateWins = comparableRows.filter(
    (row) => row.verdict === "candidate" && row.acceptedForbiddenSignals === 0,
  ).length;
  const structuralFailures = startedRows.filter((row) => row.structuralFailure).length;
  const partialPersistenceFailures = startedRows.filter((row) => row.partialPersistenceFailure).length;
  const acceptedForbiddenSignals = startedRows.reduce((sum, row) => sum + row.acceptedForbiddenSignals, 0);
  const totalCost = startedRows.reduce((sum, row) => sum + row.productionEquivalentCostMicromxn, 0);
  const meanCost = startedRows.length === 0 ? 0 : totalCost / startedRows.length;
  const requiredVisualWins = Math.ceil(0.9 * comparableRows.length);
  const failures: string[] = [];
  if (startedRows.length !== VISUAL_ENGINE_2A_PILOT_SIZE) failures.push("started");
  if (technicalSuccesses < 72) failures.push("technicalSuccess");
  if (unreviewed !== 0) failures.push("reviewCoverage");
  if (invalidReviews !== 0) failures.push("invalidReview");
  if (comparableRows.length === 0 || candidateWins < requiredVisualWins) failures.push("visualPreference");
  if (structuralFailures !== 0) failures.push("structuralIntegrity");
  if (partialPersistenceFailures !== 0) failures.push("partialPersistence");
  if (acceptedForbiddenSignals !== 0) failures.push("forbiddenSignals");
  if (!(meanCost < VISUAL_ENGINE_2A_COST_LIMIT_MICROMXN)) failures.push("meanCost");
  if (!rollback.verified) failures.push("rollback");
  return {
    started: startedRows.length,
    technicalSuccesses,
    technicalFailures,
    technicalSuccessRate: startedRows.length === 0 ? 0 : technicalSuccesses / startedRows.length,
    reviewed: reviewedRows.length,
    expectedReviews,
    unreviewed,
    invalidReviews,
    comparable: comparableRows.length,
    candidateWins,
    requiredVisualWins,
    visuallyPreferredRate: comparableRows.length === 0 ? 0 : candidateWins / comparableRows.length,
    structuralFailures,
    partialPersistenceFailures,
    acceptedForbiddenSignals,
    meanProductionEquivalentCostMicromxn: meanCost,
    rollbackVerified: rollback.verified,
    failures,
    passed: failures.length === 0,
  };
}

/** Evaluation-only copy neutralization. Scripts/styles and every attribute stay byte-identical. */
export function neutralizeVisibleCopy(html: string): string {
  let hiddenDepth = 0;
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith("<")) {
      const match = /^<\s*(\/?)\s*([a-zA-Z0-9-]+)/.exec(part);
      if (match && /^(script|style|noscript|template)$/i.test(match[2])) {
        hiddenDepth += match[1] ? -1 : /\/\s*>$/.test(part) ? 0 : 1;
      }
      return part;
    }
    if (hiddenDepth > 0 || part.trim() === "") return part;
    const leading = part.match(/^\s*/)?.[0] ?? "";
    const trailing = part.match(/\s*$/)?.[0] ?? "";
    return `${leading}Neutral copy${trailing}`;
  }).join("");
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function canonicalJsonSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export interface VisualEngine2ARollbackEvidence {
  schemaVersion: "visual-engine-2a-rollback/1.0";
  fixtureSha256: string;
  unsetOutputSha256: string;
  offOutputSha256: string;
  shadowOutputSha256: string;
  unsetDeliverySha256: string;
  offDeliverySha256: string;
  shadowDeliverySha256: string;
  unsetCreativeCalls: 0;
  unsetPilotCalls: 0;
  offCreativeCalls: 0;
  offPilotCalls: 0;
  shadowCreativeCalls: 1;
  shadowPilotCalls: 1;
  candidateJobs: 1;
  verified: true;
  evidenceSha256: string;
}

export interface VisualEngine2ARollbackState {
  selectedTemplateId: string;
  finalizedHtml: string;
  previewSequence: unknown[];
  projectData: unknown;
  creditDelta: number;
  creativeCalls: number;
  pilotCalls: number;
  candidateJobs: number;
}

function rollbackDelivery(state: VisualEngine2ARollbackState) {
  return {
    selectedTemplateId: state.selectedTemplateId,
    finalizedHtml: state.finalizedHtml,
    previewSequence: state.previewSequence,
    projectData: state.projectData,
    creditDelta: state.creditDelta,
  };
}

export function buildRollbackEvidence(args: {
  fixture: unknown;
  unset: VisualEngine2ARollbackState;
  off: VisualEngine2ARollbackState;
  shadow: VisualEngine2ARollbackState;
}): VisualEngine2ARollbackEvidence {
  const unsetOutputSha256 = canonicalJsonSha256(args.unset);
  const offOutputSha256 = canonicalJsonSha256(args.off);
  const shadowOutputSha256 = canonicalJsonSha256(args.shadow);
  const unsetDeliverySha256 = canonicalJsonSha256(rollbackDelivery(args.unset));
  const offDeliverySha256 = canonicalJsonSha256(rollbackDelivery(args.off));
  const shadowDeliverySha256 = canonicalJsonSha256(rollbackDelivery(args.shadow));
  if (unsetOutputSha256 !== offOutputSha256
    || unsetDeliverySha256 !== offDeliverySha256
    || unsetDeliverySha256 !== shadowDeliverySha256
    || args.unset.creativeCalls !== 0 || args.unset.pilotCalls !== 0 || args.unset.candidateJobs !== 0
    || args.off.creativeCalls !== 0 || args.off.pilotCalls !== 0 || args.off.candidateJobs !== 0
    || args.shadow.creativeCalls !== 1 || args.shadow.pilotCalls !== 1 || args.shadow.candidateJobs !== 1) {
    throw new Error("rollback verification failed");
  }
  const evidence = {
    schemaVersion: "visual-engine-2a-rollback/1.0",
    fixtureSha256: canonicalJsonSha256(args.fixture),
    unsetOutputSha256, offOutputSha256, shadowOutputSha256,
    unsetDeliverySha256, offDeliverySha256, shadowDeliverySha256,
    unsetCreativeCalls: 0, unsetPilotCalls: 0,
    offCreativeCalls: 0, offPilotCalls: 0,
    shadowCreativeCalls: 1, shadowPilotCalls: 1,
    candidateJobs: 1,
    verified: true,
  } as const;
  return { ...evidence, evidenceSha256: canonicalJsonSha256(evidence) };
}

export function validateRollbackEvidence(
  value: VisualEngine2ARollbackEvidence,
  expectedFixtureSha256: string,
): boolean {
  return value.schemaVersion === "visual-engine-2a-rollback/1.0"
    && validEvidenceHash(value.fixtureSha256)
    && value.fixtureSha256 === expectedFixtureSha256
    && value.unsetOutputSha256 === value.offOutputSha256
    && validEvidenceHash(value.unsetOutputSha256)
    && validEvidenceHash(value.shadowOutputSha256)
    && value.unsetDeliverySha256 === value.offDeliverySha256
    && value.unsetDeliverySha256 === value.shadowDeliverySha256
    && validEvidenceHash(value.unsetDeliverySha256)
    && value.unsetCreativeCalls === 0 && value.unsetPilotCalls === 0
    && value.offCreativeCalls === 0 && value.offPilotCalls === 0
    && value.shadowCreativeCalls === 1 && value.shadowPilotCalls === 1
    && value.candidateJobs === 1
    && value.verified === true
    && value.evidenceSha256 === canonicalJsonSha256({
      schemaVersion: value.schemaVersion,
      fixtureSha256: value.fixtureSha256,
      unsetOutputSha256: value.unsetOutputSha256,
      offOutputSha256: value.offOutputSha256,
      shadowOutputSha256: value.shadowOutputSha256,
      unsetDeliverySha256: value.unsetDeliverySha256,
      offDeliverySha256: value.offDeliverySha256,
      shadowDeliverySha256: value.shadowDeliverySha256,
      unsetCreativeCalls: value.unsetCreativeCalls,
      unsetPilotCalls: value.unsetPilotCalls,
      offCreativeCalls: value.offCreativeCalls,
      offPilotCalls: value.offPilotCalls,
      shadowCreativeCalls: value.shadowCreativeCalls,
      shadowPilotCalls: value.shadowPilotCalls,
      candidateJobs: value.candidateJobs,
      verified: value.verified,
    });
}

export async function captureVisualEngine2ARollbackModes<T>(deliver: () => Promise<T>): Promise<{
  unset: T; off: T; shadow: T;
}> {
  const previous = process.env.OPENLEN_VISUAL_ENGINE;
  try {
    delete process.env.OPENLEN_VISUAL_ENGINE;
    const unset = await deliver();
    process.env.OPENLEN_VISUAL_ENGINE = "off";
    const off = await deliver();
    process.env.OPENLEN_VISUAL_ENGINE = "shadow";
    const shadow = await deliver();
    return { unset, off, shadow };
  } finally {
    if (previous === undefined) delete process.env.OPENLEN_VISUAL_ENGINE;
    else process.env.OPENLEN_VISUAL_ENGINE = previous;
  }
}

function validEvidenceHash(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

export interface VisualEngine2AEvidenceManifest {
  schemaVersion: "visual-engine-2a-evidence/1.0";
  caseId: string;
  scenarioId: string;
  pilotRunId: string;
  baselineNormalSha256: string;
  baselineNeutralSha256: string;
  candidateNormalSha256: string;
  candidateNeutralSha256: string;
}

export function buildEvidenceManifest(args: {
  caseId: string; scenarioId: string;
  pilotRunId: string;
  baselineNormal: Uint8Array; baselineNeutral: Uint8Array;
  candidateNormal: Uint8Array; candidateNeutral: Uint8Array;
}): VisualEngine2AEvidenceManifest {
  return {
    schemaVersion: "visual-engine-2a-evidence/1.0",
    caseId: args.caseId,
    scenarioId: args.scenarioId,
    pilotRunId: args.pilotRunId,
    baselineNormalSha256: sha256(args.baselineNormal),
    baselineNeutralSha256: sha256(args.baselineNeutral),
    candidateNormalSha256: sha256(args.candidateNormal),
    candidateNeutralSha256: sha256(args.candidateNeutral),
  };
}

export interface PilotAdaptationSuccess {
  ok: true;
  html: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; thinkingTokens: number };
  durationMs: number;
  structuralFingerprintBefore: string;
  structuralFingerprintAfter: string;
  promptVersion: string;
  contractVersion: string;
  policyVersion: string;
  taxonomyVersion: string;
  modelVersion: string;
}

export type PilotAdaptationResult = PilotAdaptationSuccess | {
  ok: false;
  reasonCode: CompleteVisualEnginePilotRunOutcome["reasonCode"];
  usage?: PilotAdaptationSuccess["usage"];
  durationMs: number;
};

/**
 * Executes only after a successful 150-row preflight. Every dependency that
 * can touch production state, Chromium or a model is injected so tests cannot
 * accidentally spend quota. No HTML, copy, brief or raw response crosses the
 * scalar completion boundary.
 */
export async function generateVisualEngine2AEvidence(args: {
  eligible: ReadonlyArray<VisualEngine2APoolRow & { templateId: string }>;
  rateCardVersion: string;
  calculateCosts: (
    creative: PilotAdaptationSuccess["usage"],
    critic: PilotAdaptationSuccess["usage"],
    duplicateShadowCandidateFill?: PilotAdaptationSuccess["usage"],
  ) => { productionEquivalentCostMicromxn: number; observedPilotCostMicromxn: number };
  deps: {
    reserve(row: VisualEngine2APoolRow & { templateId: string }): Promise<{ ok: true; id: string } | { ok: false }>;
    baseline(row: VisualEngine2APoolRow & { templateId: string }): Promise<{
      html: string;
      duplicateShadowCandidateFill?: PilotAdaptationSuccess["usage"];
    }>;
    adapt(row: VisualEngine2APoolRow & { templateId: string }): Promise<PilotAdaptationResult>;
    critique(row: VisualEngine2APoolRow & { templateId: string }, html: string): Promise<CritiqueVerdict>;
    render(html: string): Promise<Uint8Array | null>;
    writeEvidence(key: string, files: Record<string, Uint8Array>, manifest: VisualEngine2AEvidenceManifest): Promise<void>;
    complete(id: string, outcome: CompleteVisualEnginePilotRunOutcome): Promise<void>;
  };
}): Promise<{ started: number; evidence: number }> {
  if (args.eligible.length !== VISUAL_ENGINE_2A_PILOT_SIZE) throw new Error("pilot requires exactly 75 preflight rows");
  let started = 0; let evidence = 0;
  for (const row of args.eligible) {
    const reservation = await args.deps.reserve(row);
    if (!reservation.ok) throw new Error("pilot quota became inconsistent after preflight");
    started += 1;
    let terminalFailure: CompleteVisualEnginePilotRunOutcome = {
      status: "failed", reasonCode: "internal_error", rateCardVersion: args.rateCardVersion,
      candidatePersisted: false,
    };
    try {
      const [baseline, adapted] = await Promise.all([args.deps.baseline(row), args.deps.adapt(row)]);
      if (!adapted.ok) {
        const zero = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
        const costs = args.calculateCosts(adapted.usage ?? zero, zero, baseline.duplicateShadowCandidateFill);
        await args.deps.complete(reservation.id, {
          status: "fallback", reasonCode: adapted.reasonCode,
          rateCardVersion: args.rateCardVersion,
          inputTokens: adapted.usage?.inputTokens, outputTokens: adapted.usage?.outputTokens,
          cachedTokens: adapted.usage?.cachedTokens, thinkingTokens: adapted.usage?.thinkingTokens,
          durationMs: adapted.durationMs, candidatePersisted: false, structuralInvariantPassed: false,
          ...costs,
        });
        continue;
      }
      const critic = await args.deps.critique(row, adapted.html);
      const criticUsage = critic.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
      const costs = args.calculateCosts(adapted.usage, criticUsage, baseline.duplicateShadowCandidateFill);
      terminalFailure = {
        ...terminalFailure,
        inputTokens: adapted.usage.inputTokens, outputTokens: adapted.usage.outputTokens,
        cachedTokens: adapted.usage.cachedTokens, thinkingTokens: adapted.usage.thinkingTokens,
        durationMs: adapted.durationMs, ...costs,
      };
      const [baselineNormal, baselineNeutral, candidateNormal, candidateNeutral] = await Promise.all([
        args.deps.render(baseline.html), args.deps.render(neutralizeVisibleCopy(baseline.html)),
        args.deps.render(adapted.html), args.deps.render(neutralizeVisibleCopy(adapted.html)),
      ]);
      if (!baselineNormal || !baselineNeutral || !candidateNormal || !candidateNeutral) {
        await args.deps.complete(reservation.id, {
          status: "failed", reasonCode: "technical_render_failed",
          rateCardVersion: args.rateCardVersion,
          ...adapted.usage, durationMs: adapted.durationMs,
          candidatePersisted: false, structuralInvariantPassed: true,
          ...costs,
        });
        continue;
      }
      const manifest = buildEvidenceManifest({
        caseId: row.caseId, scenarioId: row.scenarioId,
        pilotRunId: reservation.id,
        baselineNormal, baselineNeutral, candidateNormal, candidateNeutral,
      });
      const key = canonicalJsonSha256(manifest).slice("sha256:".length);
      await args.deps.writeEvidence(key, { baselineNormal, baselineNeutral, candidateNormal, candidateNeutral }, manifest);
      evidence += 1;
      await args.deps.complete(reservation.id, {
        status: "adapted",
        promptVersion: adapted.promptVersion, contractVersion: adapted.contractVersion,
        policyVersion: adapted.policyVersion, taxonomyVersion: adapted.taxonomyVersion,
        modelVersion: adapted.modelVersion,
        rateCardVersion: args.rateCardVersion,
        inputTokens: adapted.usage.inputTokens, outputTokens: adapted.usage.outputTokens,
        cachedTokens: adapted.usage.cachedTokens, thinkingTokens: adapted.usage.thinkingTokens,
        ...costs,
        durationMs: adapted.durationMs,
        criticVisualQualityScore: critic.visualQuality,
        criticBriefAdherenceScore: critic.briefAdherence,
        criticFallback: critic.fallback,
        structuralFingerprintBefore: adapted.structuralFingerprintBefore,
        structuralFingerprintAfter: adapted.structuralFingerprintAfter,
        candidatePersisted: false,
        structuralInvariantPassed: adapted.structuralFingerprintBefore === adapted.structuralFingerprintAfter,
      });
    } catch {
      await args.deps.complete(reservation.id, terminalFailure).catch(() => undefined);
    }
  }
  return { started, evidence };
}
