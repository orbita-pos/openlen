import { INTENT_PROMPT_VERSION } from "./analyze-intent";
import { DECISION_POLICY_VERSION } from "./decide-route";
import {
  calculateModelCostMicros,
  type ModelTokenUsage,
  type PilotRateCard,
} from "./model-cost";
import type { SafeSelectionResult } from "./safe-selection";
import { TAXONOMY_COMPATIBILITY_VERSION } from "./taxonomy-compatibility";
import {
  VISUAL_ENGINE_2A_DATASET_VERSION,
  type VisualEngine2APilotCase,
} from "./visual-engine-2a-cohort";
import {
  buildVisualEngine2APool,
  canonicalJsonSha256,
  type PilotPreflightCounts,
  type QualifiedPilotRow,
  type VisualEngine2APoolRow,
} from "./visual-engine-2a-eval";
import {
  verifyVisualEngine2AQualification,
  type VisualEngine2AQualificationManifest,
} from "./visual-engine-2a-qualification";

export type PreflightFailureCode =
  | "invalid_quota"
  | "existing_runs"
  | "qualification_stale"
  | "qualification_invalid"
  | "selection_failed"
  | "ineligible_route"
  | "template_outside_allowlist";

export interface VisualEngine2APreflightReport {
  schemaVersion: "visual-engine-2a-preflight/1.0";
  datasetVersion: typeof VISUAL_ENGINE_2A_DATASET_VERSION;
  datasetSha256: string;
  qualificationManifestSha256: string;
  commitSha: string;
  modelId: string;
  promptVersion: string;
  policyVersion: string;
  taxonomyVersion: string;
  rateCardVersion: string;
  counts: PilotPreflightCounts;
  tokens: ModelTokenUsage | null;
  usageComplete: boolean;
  productionEquivalentCostMicromxn: number | null;
  totalDurationMs: number;
  reservationCount: 0;
  reportSha256: string;
}

export interface VisualEngine2APreflightDependencies {
  cases: readonly VisualEngine2APilotCase[];
  qualification: VisualEngine2AQualificationManifest;
  currentQualification: Omit<VisualEngine2AQualificationManifest, "manifestSha256">;
  quota: { limit: number; used: number; existingRuns: number };
  modelId: string;
  rateCard: PilotRateCard;
  mxnPerUsd: number;
  select(row: VisualEngine2APoolRow): Promise<SafeSelectionResult>;
  now?: () => number;
}

type PreflightResult =
  | { ok: true; eligible: readonly QualifiedPilotRow[]; report: VisualEngine2APreflightReport }
  | { ok: false; code: PreflightFailureCode; report: VisualEngine2APreflightReport };

function emptyCounts(pool: number): PilotPreflightCounts {
  return {
    pool,
    analyzed: 0,
    selectionFailures: 0,
    templateSkeleton: 0,
    templateFull: 0,
    sectionComposition: 0,
    safeFailure: 0,
    scratchControlled: 0,
  };
}

function validHash(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/i.test(value);
}

function validCommit(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

export function visualEngine2AQualificationIsInternallyValid(
  args: Pick<VisualEngine2APreflightDependencies, "cases" | "currentQualification">,
): boolean {
  const current = args.currentQualification;
  if (current.schemaVersion !== "visual-engine-2a-qualification/1.0"
    || current.datasetVersion !== VISUAL_ENGINE_2A_DATASET_VERSION
    || current.datasetSha256 !== canonicalJsonSha256(args.cases)
    || !validHash(current.datasetSha256)
    || !validHash(current.catalogSha256)
    || !validCommit(current.commitSha)
    || current.promptVersion !== INTENT_PROMPT_VERSION
    || current.policyVersion !== DECISION_POLICY_VERSION
    || current.taxonomyVersion !== TAXONOMY_COMPATIBILITY_VERSION
    || current.baseCaseCount !== 15
    || current.expandedRowCount !== 75
    || args.cases.length !== 15
    || current.cases.length !== 15) return false;

  const byId = new Map(args.cases.map((item) => [item.id, item]));
  if (byId.size !== 15 || new Set(current.cases.map((item) => item.caseId)).size !== 15) return false;
  for (const item of current.cases) {
    const source = byId.get(item.caseId);
    if (!source
      || !source.allowedSkeletonTemplateIds.includes(item.selectedTemplateId)
      || item.allowedTemplateIdsSha256 !== canonicalJsonSha256([...source.allowedSkeletonTemplateIds].sort())) {
      return false;
    }
  }
  const selections = new Map<string, number>();
  for (const item of current.cases) {
    selections.set(item.selectedTemplateId, (selections.get(item.selectedTemplateId) ?? 0) + 1);
  }
  if (selections.size < 10 || [...selections.values()].some((count) => count > 2)) return false;

  if (current.templates.length === 0
    || new Set(current.templates.map((item) => item.id)).size !== current.templates.length
    || current.templates.some((item) => !item.id.trim()
      || !validHash(item.metadataSha256)
      || !validHash(item.htmlSha256)
      || !validHash(item.inventorySha256))) return false;
  return true;
}

function addUsage(total: ModelTokenUsage, usage: ModelTokenUsage): void {
  total.inputTokens += usage.inputTokens;
  total.cachedTokens += usage.cachedTokens;
  total.outputTokens += usage.outputTokens;
  total.thinkingTokens += usage.thinkingTokens;
}

function elapsed(started: number, now: () => number): number {
  const value = now() - started;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function report(args: {
  deps: VisualEngine2APreflightDependencies;
  counts: PilotPreflightCounts;
  tokens: ModelTokenUsage | null;
  usageComplete: boolean;
  cost: number | null;
  totalDurationMs: number;
}): VisualEngine2APreflightReport {
  const unsigned = {
    schemaVersion: "visual-engine-2a-preflight/1.0" as const,
    datasetVersion: VISUAL_ENGINE_2A_DATASET_VERSION,
    datasetSha256: canonicalJsonSha256(args.deps.cases),
    qualificationManifestSha256: args.deps.qualification.manifestSha256,
    commitSha: args.deps.currentQualification.commitSha,
    modelId: args.deps.modelId,
    promptVersion: args.deps.currentQualification.promptVersion,
    policyVersion: args.deps.currentQualification.policyVersion,
    taxonomyVersion: args.deps.currentQualification.taxonomyVersion,
    rateCardVersion: args.deps.rateCard.version,
    counts: args.counts,
    tokens: args.tokens,
    usageComplete: args.usageComplete,
    productionEquivalentCostMicromxn: args.cost,
    totalDurationMs: args.totalDurationMs,
    reservationCount: 0 as const,
  };
  return { ...unsigned, reportSha256: canonicalJsonSha256(unsigned) };
}

export async function runVisualEngine2APreflight(
  args: VisualEngine2APreflightDependencies,
): Promise<PreflightResult> {
  const now = args.now ?? Date.now;
  const started = now();
  const pool = buildVisualEngine2APool(args.cases);
  const counts = emptyCounts(pool.length);
  const failedBeforeProvider = (code: PreflightFailureCode): PreflightResult => ({
    ok: false,
    code,
    report: report({
      deps: args,
      counts,
      tokens: null,
      usageComplete: false,
      cost: null,
      totalDurationMs: elapsed(started, now),
    }),
  });

  if (args.quota.limit !== 75 || args.quota.used !== 0) return failedBeforeProvider("invalid_quota");
  if (args.quota.existingRuns !== 0) return failedBeforeProvider("existing_runs");
  if (!visualEngine2AQualificationIsInternallyValid(args)) return failedBeforeProvider("qualification_invalid");
  if (!verifyVisualEngine2AQualification({
    manifest: args.qualification,
    current: args.currentQualification,
  }).ok) return failedBeforeProvider("qualification_stale");

  const settled = await Promise.all(pool.map(async (row) => {
    try {
      return { row, result: await args.select(row) };
    } catch {
      return {
        row,
        result: { ok: false, errorKind: "unexpected_error", durationMs: 0 } as SafeSelectionResult,
      };
    }
  }));

  counts.analyzed = settled.length;
  const aggregate: ModelTokenUsage = {
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };
  let usageComplete = settled.length === 75;
  let failureCode: PreflightFailureCode | null = null;
  const eligible: QualifiedPilotRow[] = [];
  const qualificationByCase = new Map(args.qualification.cases.map((item) => [item.caseId, item]));
  for (const { row, result } of settled) {
    if (result.usage) addUsage(aggregate, result.usage);
    else usageComplete = false;
    if (!result.ok) {
      counts.selectionFailures += 1;
      failureCode ??= "selection_failed";
      continue;
    }
    if (result.modelId !== args.modelId
      || result.promptVersion !== args.qualification.promptVersion
      || result.policyVersion !== args.qualification.policyVersion) {
      counts.selectionFailures += 1;
      failureCode ??= "selection_failed";
      continue;
    }
    if (result.decision.route === "template_full") counts.templateFull += 1;
    else if (result.decision.route === "section_composition") counts.sectionComposition += 1;
    else if (result.decision.route === "safe_failure") counts.safeFailure += 1;
    else if (result.decision.route === "scratch_controlled") counts.scratchControlled += 1;
    if (result.decision.route !== "template_skeleton" || !result.decision.templateId) {
      counts.selectionFailures += 1;
      failureCode ??= "ineligible_route";
      continue;
    }
    const qualifiedTemplateId = qualificationByCase.get(row.caseId)?.selectedTemplateId;
    if (!row.allowedSkeletonTemplateIds.includes(result.decision.templateId)
      || result.decision.templateId !== qualifiedTemplateId) {
      counts.selectionFailures += 1;
      failureCode ??= "template_outside_allowlist";
      continue;
    }
    counts.templateSkeleton += 1;
    eligible.push({ ...row, templateId: result.decision.templateId });
  }
  if (eligible.length !== 75) failureCode ??= "selection_failed";

  const tokens = usageComplete ? aggregate : null;
  const cost = tokens
    ? calculateModelCostMicros({ intent: tokens }, args.rateCard, args.mxnPerUsd)
      .productionEquivalentCostMicromxn
    : null;
  const finalReport = report({
    deps: args,
    counts,
    tokens,
    usageComplete,
    cost,
    totalDurationMs: elapsed(started, now),
  });
  if (failureCode) return { ok: false, code: failureCode, report: finalReport };
  return { ok: true, eligible, report: finalReport };
}
