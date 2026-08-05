import {
  GenerationDecisionSchema,
  ReasonCodeSchema,
  type GenerationDecision,
  type ReasonCode,
} from "./contracts";
import type { ScoredTemplate } from "./score-template";

export const DECISION_POLICY_VERSION = "template-policy/1.0" as const;

export interface DecisionThresholds {
  fullStructural: number;
  fullIdentity: number;
  skeletonStructural: number;
  skeletonMaxAdaptationCost: number;
}

export const DEFAULT_THRESHOLDS: Readonly<DecisionThresholds> = Object.freeze({
  fullStructural: 0.75,
  fullIdentity: 0.80,
  skeletonStructural: 0.75,
  skeletonMaxAdaptationCost: 0.60,
});

function compare(left: ScoredTemplate, right: ScoredTemplate): number {
  return Number(right.eligible) - Number(left.eligible)
    || right.structuralFit - left.structuralFit
    || right.identityFit - left.identityFit
    || left.adaptationCost - right.adaptationCost
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function assertThresholds(thresholds: DecisionThresholds): void {
  const values = Object.values(thresholds);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError("Decision thresholds must be finite values between 0 and 1.");
  }
}

function isUnitScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function assertCandidates(scored: readonly ScoredTemplate[]): void {
  const ids = new Set<string>();
  for (const candidate of scored) {
    const validThemeability = candidate.themeability === null
      || candidate.themeability === "low"
      || candidate.themeability === "medium"
      || candidate.themeability === "high";
    const validReasons = candidate.reasonCodes.every(
      (reason) => ReasonCodeSchema.safeParse(reason).success,
    );
    const consistentEligibility = candidate.eligible === (candidate.reasonCodes.length === 0);
    if (candidate.id.trim().length === 0
      || !isUnitScore(candidate.structuralFit)
      || !isUnitScore(candidate.identityFit)
      || !isUnitScore(candidate.adaptationCost)
      || !validThemeability
      || !validReasons
      || !consistentEligibility) {
      throw new TypeError("Scored candidates must satisfy the runtime scoring contract.");
    }
    if (ids.has(candidate.id)) {
      throw new TypeError("Scored candidate ids must be unique.");
    }
    ids.add(candidate.id);
  }
}

function thresholdReasons(
  candidate: ScoredTemplate,
  thresholds: DecisionThresholds,
): ReasonCode[] {
  const reasons = [...candidate.reasonCodes];
  if (candidate.structuralFit < thresholds.fullStructural) {
    reasons.push("structure_below_threshold");
  }
  if (candidate.identityFit < thresholds.fullIdentity) {
    reasons.push("identity_below_threshold");
  }
  if (candidate.adaptationCost > thresholds.skeletonMaxAdaptationCost) {
    reasons.push("adaptation_cost_too_high");
  }
  const meetsFullThresholds = candidate.structuralFit >= thresholds.fullStructural
    && candidate.identityFit >= thresholds.fullIdentity;
  if (!meetsFullThresholds && candidate.themeability !== "high") {
    reasons.push("themeability_below_threshold");
  }
  return [...new Set(reasons)];
}

export function decideGenerationRoute(
  scored: readonly ScoredTemplate[],
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS,
): GenerationDecision {
  assertThresholds(thresholds);
  assertCandidates(scored);
  const ranked = [...scored].sort(compare);
  const full = ranked.find((candidate) => candidate.eligible
    && candidate.structuralFit >= thresholds.fullStructural
    && candidate.identityFit >= thresholds.fullIdentity);
  const skeleton = full ? null : ranked.find((candidate) => candidate.eligible
    && candidate.structuralFit >= thresholds.skeletonStructural
    && candidate.themeability === "high"
    && candidate.adaptationCost <= thresholds.skeletonMaxAdaptationCost);
  const chosen = full ?? skeleton ?? null;
  const top = chosen ?? ranked[0] ?? null;

  const decision: GenerationDecision = {
    schemaVersion: "generation-decision/1.0",
    route: full
      ? "template_full"
      : skeleton
        ? "template_skeleton"
        : "section_composition",
    templateId: chosen?.id ?? null,
    structuralFit: top?.structuralFit ?? 0,
    identityFit: top?.identityFit ?? 0,
    adaptationCost: top?.adaptationCost ?? 1,
    selectedSections: [],
    rejectedCandidates: ranked
      .filter((candidate) => candidate.id !== chosen?.id)
      .map((candidate) => ({
        id: candidate.id,
        reasonCodes: thresholdReasons(candidate, thresholds),
      })),
  };
  return GenerationDecisionSchema.parse(decision);
}
