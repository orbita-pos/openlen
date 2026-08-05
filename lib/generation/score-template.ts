import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";

import type { IntentAnalysis, ReasonCode } from "./contracts";
import {
  audienceCompatibility,
  domainCompatibility,
  sectionRoleCompatibility,
  siteTypeCompatibility,
  type Compatibility,
} from "./taxonomy-compatibility";

export interface ScorableTemplate {
  id: string;
  visualMetadata: TemplateVisualMetadata | null;
}

export interface ScoredTemplate {
  id: string;
  eligible: boolean;
  structuralFit: number;
  identityFit: number;
  adaptationCost: number;
  themeability: "low" | "medium" | "high" | null;
  reasonCodes: ReasonCode[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function overlapRatio(required: readonly string[], candidate: readonly string[]): number {
  const uniqueRequired = [...new Set(required)];
  if (uniqueRequired.length === 0) return 0;
  const candidateValues = new Set(candidate);
  return uniqueRequired.filter((value) => candidateValues.has(value)).length
    / uniqueRequired.length;
}

type CompatibilityMatcher = (required: string, candidate: string) => Compatibility;

function compatibilityRatio(
  required: readonly string[],
  candidate: readonly string[],
  matcher: CompatibilityMatcher,
): number {
  const uniqueRequired = [...new Set(required)];
  if (uniqueRequired.length === 0) return 0;
  return uniqueRequired.reduce((total, requiredValue) => {
    const best = candidate.reduce(
      (highest, candidateValue) => Math.max(
        highest,
        matcher(requiredValue, candidateValue).score,
      ),
      0,
    );
    return total + best;
  }, 0) / uniqueRequired.length;
}

function bestCompatibility(
  required: string,
  candidates: readonly string[],
  matcher: CompatibilityMatcher,
): number {
  return candidates.reduce(
    (highest, candidate) => Math.max(highest, matcher(required, candidate).score),
    0,
  );
}

interface WeightedSignal {
  active: boolean;
  score: number;
  weight: number;
}

function activeWeightedAverage(signals: readonly WeightedSignal[]): number {
  const activeSignals = signals.filter((signal) => signal.active);
  const activeWeight = activeSignals.reduce((total, signal) => total + signal.weight, 0);
  if (activeWeight === 0) return 0;
  return activeSignals.reduce(
    (total, signal) => total + signal.score * signal.weight,
    0,
  ) / activeWeight;
}

function includesOrGeneral(candidate: readonly string[], required: string): number {
  return candidate.includes(required) || candidate.includes("general") ? 1 : 0;
}

function hasUnknownClassification(intent: IntentAnalysis): boolean {
  return intent.functional.siteType === "unknown"
    || intent.functional.contentModel === "unknown"
    || intent.audience.primary === "unknown"
    || intent.domains.includes("unknown");
}

interface AgeInterval {
  minimum: number;
  maximum: number;
}

const SEMANTIC_AGE_INTERVALS: Readonly<Record<string, AgeInterval>> = {
  infants: { minimum: 0, maximum: 2 },
  toddlers: { minimum: 1, maximum: 4 },
  children: { minimum: 3, maximum: 12 },
  teenagers: { minimum: 13, maximum: 17 },
  young_adults: { minimum: 18, maximum: 34 },
  adult: { minimum: 18, maximum: 64 },
  adults: { minimum: 18, maximum: 64 },
  middle_aged: { minimum: 40, maximum: 64 },
  mature_adults: { minimum: 45, maximum: 64 },
  seniors: { minimum: 65, maximum: Number.POSITIVE_INFINITY },
  elderly: { minimum: 65, maximum: Number.POSITIVE_INFINITY },
  all_ages: { minimum: 0, maximum: Number.POSITIVE_INFINITY },
};

function parseAgeInterval(value: string): AgeInterval | null {
  const semantic = SEMANTIC_AGE_INTERVALS[value];
  if (semantic) return semantic;
  const bounded = /^(0|[1-9]\d{0,2})_(0|[1-9]\d{0,2})$/.exec(value);
  if (bounded) {
    const minimum = Number(bounded[1]);
    const maximum = Number(bounded[2]);
    return minimum <= maximum ? { minimum, maximum } : null;
  }
  const openEnded = /^(0|[1-9]\d{0,2})_plus$/.exec(value);
  return openEnded
    ? { minimum: Number(openEnded[1]), maximum: Number.POSITIVE_INFINITY }
    : null;
}

function overlaps(left: AgeInterval, right: AgeInterval): boolean {
  return left.minimum <= right.maximum && right.minimum <= left.maximum;
}

function ageCoverage(required: AgeInterval, candidate: AgeInterval): number {
  if (!overlaps(required, candidate)) return 0;
  if (required.maximum === Number.POSITIVE_INFINITY) {
    return candidate.maximum === Number.POSITIVE_INFINITY
      && candidate.minimum <= required.minimum
      ? 1
      : 0.5;
  }
  const intersectionMinimum = Math.max(required.minimum, candidate.minimum);
  const intersectionMaximum = Math.min(required.maximum, candidate.maximum);
  const requiredYears = required.maximum - required.minimum + 1;
  const coveredYears = intersectionMaximum - intersectionMinimum + 1;
  return clamp01(coveredYears / requiredYears);
}

function ageFit(intent: IntentAnalysis, metadata: TemplateVisualMetadata): number {
  if (intent.audience.ageRange === null) return 1;
  if (includesOrGeneral(metadata.ageRanges, intent.audience.ageRange)
    || metadata.ageRanges.includes("all_ages")) return 1;
  const required = parseAgeInterval(intent.audience.ageRange);
  if (!required) return 0;
  return metadata.ageRanges.reduce((best, candidate) => {
    const parsed = parseAgeInterval(candidate);
    return parsed ? Math.max(best, ageCoverage(required, parsed)) : best;
  }, 0);
}

function hasExplicitAgeMismatch(
  intent: IntentAnalysis,
  metadata: TemplateVisualMetadata,
): boolean {
  if (intent.audience.ageRange === null || metadata.ageRanges.length === 0) return false;
  if (includesOrGeneral(metadata.ageRanges, intent.audience.ageRange)
    || metadata.ageRanges.includes("all_ages")) return false;
  const required = parseAgeInterval(intent.audience.ageRange);
  if (!required) return false;
  const candidates = metadata.ageRanges.flatMap((candidate) => {
    const parsed = parseAgeInterval(candidate);
    return parsed ? [parsed] : [];
  });
  return candidates.length > 0 && !candidates.some((candidate) => overlaps(required, candidate));
}

function intentAudienceLabels(intent: IntentAnalysis): string[] {
  return [
    intent.audience.primary,
    ...intent.audience.secondary,
    ...(intent.audience.ageRange ? [intent.audience.ageRange] : []),
  ];
}

function themeabilityScore(value: TemplateVisualMetadata["themeability"]): number {
  if (value === "high") return 1;
  if (value === "medium") return 0.5;
  return 0;
}

function pushReason(reasonCodes: ReasonCode[], reason: ReasonCode): void {
  if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
}

export function scoreTemplate(
  intent: IntentAnalysis,
  template: ScorableTemplate,
): ScoredTemplate {
  const reasonCodes: ReasonCode[] = [];
  if (hasUnknownClassification(intent)) pushReason(reasonCodes, "intent_ambiguous");

  const metadata = template.visualMetadata;
  if (!metadata) {
    pushReason(reasonCodes, "metadata_missing");
    return {
      id: template.id,
      eligible: false,
      structuralFit: 0,
      identityFit: 0,
      adaptationCost: 1,
      themeability: null,
      reasonCodes,
    };
  }

  const siteTypeFit = bestCompatibility(
    intent.functional.siteType,
    metadata.supportedSiteTypes,
    siteTypeCompatibility,
  );
  const primaryAudienceFit = bestCompatibility(
    intent.audience.primary,
    metadata.audiences,
    audienceCompatibility,
  );
  if (metadata.reviewStatus !== "reviewed") pushReason(reasonCodes, "metadata_unreviewed");
  if (siteTypeFit === 0) {
    pushReason(reasonCodes, "unsupported_site_type");
  }
  if (primaryAudienceFit === 0
    || hasExplicitAgeMismatch(intent, metadata)) {
    pushReason(reasonCodes, "audience_mismatch");
  }
  if (compatibilityRatio(intent.domains, metadata.negativeTags, domainCompatibility) > 0) {
    pushReason(reasonCodes, "domain_incompatible");
  }
  if (intersects(intentAudienceLabels(intent), metadata.negativeTags)) {
    pushReason(reasonCodes, "audience_mismatch");
  }
  if (intersects(intent.forbiddenVisualSignals, metadata.visualSignals)) {
    pushReason(reasonCodes, "forbidden_visual_signal");
  }

  const structuralFit = clamp01(activeWeightedAverage([
    {
      active: intent.functional.requiredSections.length > 0,
      score: compatibilityRatio(
        intent.functional.requiredSections,
        metadata.supportedSectionRoles,
        sectionRoleCompatibility,
      ),
      weight: 0.70,
    },
    {
      active: intent.functional.siteType !== "unknown",
      score: siteTypeFit,
      weight: 0.30,
    },
  ]));
  const identityFit = clamp01(activeWeightedAverage([
    {
      active: intent.domains.some((domain) => domain !== "unknown"),
      score: compatibilityRatio(intent.domains, metadata.domains, domainCompatibility),
      weight: 0.30,
    },
    {
      active: intent.audience.primary !== "unknown",
      score: primaryAudienceFit,
      weight: 0.20,
    },
    {
      active: intent.audience.ageRange !== null,
      score: ageFit(intent, metadata),
      weight: 0.10,
    },
    {
      active: intent.emotionalGoals.length > 0,
      score: overlapRatio(intent.emotionalGoals, metadata.emotionalRegisters),
      weight: 0.20,
    },
    {
      active: intent.requiredVisualSignals.length > 0,
      score: overlapRatio(intent.requiredVisualSignals, metadata.visualSignals),
      weight: 0.20,
    },
  ]));
  const adaptationCost = clamp01(
    1 - (0.60 * identityFit + 0.40 * themeabilityScore(metadata.themeability)),
  );

  return {
    id: template.id,
    eligible: reasonCodes.length === 0,
    structuralFit,
    identityFit,
    adaptationCost,
    themeability: metadata.themeability,
    reasonCodes,
  };
}

export function rankTemplates(
  intent: IntentAnalysis,
  templates: readonly ScorableTemplate[],
): ScoredTemplate[] {
  return templates
    .map((template) => scoreTemplate(intent, template))
    .sort((left, right) =>
      Number(right.eligible) - Number(left.eligible)
      || right.structuralFit - left.structuralFit
      || right.identityFit - left.identityFit
      || left.adaptationCost - right.adaptationCost
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
