import {
  calculateModelCostMicros,
  type ModelTokenUsage,
  type PilotRateCard,
} from "./model-cost";
import type { SafeSelectionResult } from "./safe-selection";
import type { ReasonCode } from "./contracts";
import {
  VISUAL_ENGINE_2A_DATASET_VERSION,
  type VisualEngine2APilotCase,
} from "./visual-engine-2a-cohort";
import {
  buildVisualEngine2APool,
  canonicalJsonSha256,
  type QualifiedPilotRow,
  type VisualEngine2APoolRow,
} from "./visual-engine-2a-eval";
import { visualEngine2AQualificationIsInternallyValid } from "./visual-engine-2a-preflight";
import {
  verifyVisualEngine2AQualification,
  type VisualEngine2AQualificationManifest,
} from "./visual-engine-2a-qualification";

export type VisualEngine2ALiveCanaryFailureCode =
  | "invalid_quota"
  | "existing_runs"
  | "qualification_invalid"
  | "qualification_stale"
  | "selection_failed"
  | "version_mismatch"
  | "usage_missing"
  | "ineligible_route"
  | "template_outside_allowlist";

type CanaryRoute =
  | "template_full"
  | "template_skeleton"
  | "section_composition"
  | "scratch_controlled"
  | "safe_failure";

export type VisualEngine2ALiveCanaryResultCode =
  | "ok"
  | "missing_key"
  | "api"
  | "parse"
  | "schema"
  | "aborted"
  | "timeout"
  | "invalid_input"
  | "unexpected_error"
  | "version_mismatch"
  | "usage_missing"
  | "ineligible_route"
  | "template_outside_allowlist";

export interface VisualEngine2ALiveCanaryRow {
  caseId: string;
  route: CanaryRoute | null;
  selectedTemplateId: string | null;
  structuralFit: number | null;
  identityFit: number | null;
  adaptationCost: number | null;
  resultCode: VisualEngine2ALiveCanaryResultCode;
  usage: ModelTokenUsage | null;
  intentSha256: string | null;
  qualifiedCandidate: {
    templateId: string;
    eligible: boolean;
    structuralFit: number;
    identityFit: number;
    adaptationCost: number;
    themeability: "low" | "medium" | "high" | null;
    reasonCodes: readonly ReasonCode[];
  } | null;
  classificationMatch: {
    siteType: boolean;
    contentModel: boolean;
    primaryAudience: boolean;
    ageRange: boolean;
    sections: { expected: number; observed: number; exactOverlap: number };
    domains: { expected: number; observed: number; exactOverlap: number };
  } | null;
}

export interface VisualEngine2ALiveCanaryReport {
  schemaVersion: "visual-engine-2a-live-canary/1.1";
  datasetVersion: "visual-engine-2a-cohort/1.0";
  datasetSha256: string;
  qualificationManifestSha256: string;
  catalogSha256: string;
  commitSha: string;
  modelId: string;
  promptVersion: string;
  policyVersion: string;
  taxonomyVersion: string;
  rateCardVersion: string;
  rows: readonly VisualEngine2ALiveCanaryRow[];
  counts: { cases: 15; analyzed: number; passed: number; failed: number };
  tokens: ModelTokenUsage | null;
  usageComplete: boolean;
  productionEquivalentCostMicromxn: number | null;
  totalDurationMs: number;
  reservationCount: 0;
  reportSha256: string;
}

export type VisualEngine2ALiveCanaryResult =
  | {
      ok: true;
      eligible: readonly QualifiedPilotRow[];
      selectionsByCase: ReadonlyMap<string, Extract<SafeSelectionResult, { ok: true }>>;
      report: VisualEngine2ALiveCanaryReport;
    }
  | {
      ok: false;
      code: VisualEngine2ALiveCanaryFailureCode;
      report: VisualEngine2ALiveCanaryReport;
    };

export interface VisualEngine2ALiveCanaryDependencies {
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

const PROVIDER_RESULT_CODES = new Set<VisualEngine2ALiveCanaryResultCode>([
  "missing_key",
  "api",
  "parse",
  "schema",
  "aborted",
  "timeout",
  "invalid_input",
  "unexpected_error",
]);

function providerResultCode(errorKind: string): VisualEngine2ALiveCanaryResultCode {
  return PROVIDER_RESULT_CODES.has(errorKind as VisualEngine2ALiveCanaryResultCode)
    ? errorKind as VisualEngine2ALiveCanaryResultCode
    : "unexpected_error";
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

function emptyRow(caseId: string): VisualEngine2ALiveCanaryRow {
  return {
    caseId,
    route: null,
    selectedTemplateId: null,
    structuralFit: null,
    identityFit: null,
    adaptationCost: null,
    resultCode: "invalid_input",
    usage: null,
    intentSha256: null,
    qualifiedCandidate: null,
    classificationMatch: null,
  };
}

function exactOverlap(left: readonly string[], right: readonly string[]): number {
  const rightValues = new Set(right);
  return new Set(left.filter((value) => rightValues.has(value))).size;
}

function buildReport(args: {
  deps: VisualEngine2ALiveCanaryDependencies;
  rows: readonly VisualEngine2ALiveCanaryRow[];
  analyzed: number;
  passed: number;
  tokens: ModelTokenUsage | null;
  usageComplete: boolean;
  cost: number | null;
  totalDurationMs: number;
}): VisualEngine2ALiveCanaryReport {
  const unsigned = {
    schemaVersion: "visual-engine-2a-live-canary/1.1" as const,
    datasetVersion: VISUAL_ENGINE_2A_DATASET_VERSION,
    datasetSha256: canonicalJsonSha256(args.deps.cases),
    qualificationManifestSha256: args.deps.qualification.manifestSha256,
    catalogSha256: args.deps.currentQualification.catalogSha256,
    commitSha: args.deps.currentQualification.commitSha,
    modelId: args.deps.modelId,
    promptVersion: args.deps.currentQualification.promptVersion,
    policyVersion: args.deps.currentQualification.policyVersion,
    taxonomyVersion: args.deps.currentQualification.taxonomyVersion,
    rateCardVersion: args.deps.rateCard.version,
    rows: args.rows,
    counts: {
      cases: 15 as const,
      analyzed: args.analyzed,
      passed: args.passed,
      failed: 15 - args.passed,
    },
    tokens: args.tokens,
    usageComplete: args.usageComplete,
    productionEquivalentCostMicromxn: args.cost,
    totalDurationMs: args.totalDurationMs,
    reservationCount: 0 as const,
  };
  return { ...unsigned, reportSha256: canonicalJsonSha256(unsigned) };
}

export async function runVisualEngine2ALiveCanary(
  args: VisualEngine2ALiveCanaryDependencies,
): Promise<VisualEngine2ALiveCanaryResult> {
  const now = args.now ?? Date.now;
  const started = now();
  const pool = buildVisualEngine2APool(args.cases);
  const representatives = pool.filter((row) => row.scenarioId === "plain");
  const preProviderFailure = (code: VisualEngine2ALiveCanaryFailureCode): VisualEngine2ALiveCanaryResult => ({
    ok: false,
    code,
    report: buildReport({
      deps: args,
      rows: representatives.map((row) => emptyRow(row.caseId)),
      analyzed: 0,
      passed: 0,
      tokens: null,
      usageComplete: false,
      cost: null,
      totalDurationMs: elapsed(started, now),
    }),
  });

  if (args.quota.limit !== 75 || args.quota.used !== 0) return preProviderFailure("invalid_quota");
  if (args.quota.existingRuns !== 0) return preProviderFailure("existing_runs");
  if (!visualEngine2AQualificationIsInternallyValid(args)) return preProviderFailure("qualification_invalid");
  if (!verifyVisualEngine2AQualification({
    manifest: args.qualification,
    current: args.currentQualification,
  }).ok) return preProviderFailure("qualification_stale");

  const settled = new Array<SafeSelectionResult>(representatives.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < representatives.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        settled[index] = await args.select(representatives[index]);
      } catch {
        settled[index] = { ok: false, errorKind: "unexpected_error", durationMs: 0 };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, representatives.length) }, worker));

  const qualificationByCase = new Map(args.qualification.cases.map((item) => [item.caseId, item]));
  const caseById = new Map(args.cases.map((item) => [item.id, item]));
  const aggregate: ModelTokenUsage = {
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };
  let usageComplete = settled.length === 15;
  let passed = 0;
  let failureCode: VisualEngine2ALiveCanaryFailureCode | null = null;
  const successfulSelections = new Map<string, Extract<SafeSelectionResult, { ok: true }>>();
  const rows = representatives.map((representative, index): VisualEngine2ALiveCanaryRow => {
    const result = settled[index];
    if (result.usage) addUsage(aggregate, result.usage);
    else usageComplete = false;

    if (!result.ok) {
      failureCode ??= "selection_failed";
      return {
        ...emptyRow(representative.caseId),
        resultCode: providerResultCode(result.errorKind),
        usage: result.usage ?? null,
      };
    }

    const base = {
      caseId: representative.caseId,
      route: result.decision.route,
      selectedTemplateId: result.decision.templateId,
      structuralFit: result.decision.structuralFit,
      identityFit: result.decision.identityFit,
      adaptationCost: result.decision.adaptationCost,
      usage: result.usage ?? null,
      intentSha256: canonicalJsonSha256(result.intent),
      qualifiedCandidate: (() => {
        const templateId = qualificationByCase.get(representative.caseId)?.selectedTemplateId;
        const candidate = templateId
          ? result.ranked.find((item) => item.id === templateId)
          : undefined;
        return candidate ? {
          templateId: candidate.id,
          eligible: candidate.eligible,
          structuralFit: candidate.structuralFit,
          identityFit: candidate.identityFit,
          adaptationCost: candidate.adaptationCost,
          themeability: candidate.themeability,
          reasonCodes: [...candidate.reasonCodes],
        } : null;
      })(),
      classificationMatch: (() => {
        const expected = caseById.get(representative.caseId)?.expectedIntent;
        if (!expected) return null;
        return {
          siteType: result.intent.functional.siteType === expected.functional.siteType,
          contentModel: result.intent.functional.contentModel === expected.functional.contentModel,
          primaryAudience: result.intent.audience.primary === expected.audience.primary,
          ageRange: result.intent.audience.ageRange === expected.audience.ageRange,
          sections: {
            expected: expected.functional.requiredSections.length,
            observed: result.intent.functional.requiredSections.length,
            exactOverlap: exactOverlap(
              expected.functional.requiredSections,
              result.intent.functional.requiredSections,
            ),
          },
          domains: {
            expected: expected.domains.length,
            observed: result.intent.domains.length,
            exactOverlap: exactOverlap(expected.domains, result.intent.domains),
          },
        };
      })(),
    };
    if (result.modelId !== args.modelId
      || result.promptVersion !== args.qualification.promptVersion
      || result.policyVersion !== args.qualification.policyVersion) {
      failureCode ??= "version_mismatch";
      return { ...base, resultCode: "version_mismatch" };
    }
    if (!result.usage) {
      failureCode ??= "usage_missing";
      return { ...base, resultCode: "usage_missing" };
    }
    if (result.decision.route !== "template_skeleton" || !result.decision.templateId) {
      failureCode ??= "ineligible_route";
      return { ...base, resultCode: "ineligible_route" };
    }
    const qualifiedTemplateId = qualificationByCase.get(representative.caseId)?.selectedTemplateId;
    if (!representative.allowedSkeletonTemplateIds.includes(result.decision.templateId)
      || result.decision.templateId !== qualifiedTemplateId) {
      failureCode ??= "template_outside_allowlist";
      return { ...base, resultCode: "template_outside_allowlist" };
    }

    passed += 1;
    successfulSelections.set(representative.caseId, result);
    return { ...base, resultCode: "ok" };
  });

  const tokens = usageComplete ? aggregate : null;
  const cost = tokens
    ? calculateModelCostMicros({ intent: tokens }, args.rateCard, args.mxnPerUsd)
      .productionEquivalentCostMicromxn
    : null;
  const report = buildReport({
    deps: args,
    rows,
    analyzed: settled.length,
    passed,
    tokens,
    usageComplete,
    cost,
    totalDurationMs: elapsed(started, now),
  });
  if (failureCode || passed !== 15) {
    return { ok: false, code: failureCode ?? "selection_failed", report };
  }

  const templateByCase = new Map(args.qualification.cases.map((item) => [item.caseId, item.selectedTemplateId]));
  const eligible = pool.map((row): QualifiedPilotRow => ({
    ...row,
    templateId: templateByCase.get(row.caseId)!,
  }));
  return { ok: true, eligible, selectionsByCase: successfulSelections, report };
}
