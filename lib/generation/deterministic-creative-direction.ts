import { AI_HYBRID_NICHE_CASES } from "./ai-hybrid-niche-cohort";
import {
  SkeletonAdaptationPlanSchema,
  type CreativeDirection,
  type SkeletonAdaptationPlan,
} from "./creative-contracts";
import type { IntentAnalysis } from "./contracts";

const EMPTY_SAFE_PLAN: SkeletonAdaptationPlan = SkeletonAdaptationPlanSchema.parse({
  schemaVersion: "skeleton-adaptation-plan/1.0",
  tokens: {},
  cssOverride: [],
  assets: [],
});

function words(values: readonly string[]): Set<string> {
  return new Set(values.flatMap((value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let matches = 0;
  for (const word of left) if (right.has(word)) matches += 1;
  return matches;
}

function intentWords(intent: IntentAnalysis): Set<string> {
  return words([
    intent.functional.siteType,
    intent.functional.contentModel,
    ...intent.functional.requiredSections,
    intent.audience.primary,
    ...intent.audience.secondary,
    ...intent.domains,
    ...intent.emotionalGoals,
    ...intent.requiredVisualSignals,
    ...intent.forbiddenVisualSignals,
  ]);
}

function caseWords(candidate: (typeof AI_HYBRID_NICHE_CASES)[number]): Set<string> {
  return intentWords(candidate.intent);
}

export function buildDeterministicCreativeDirection(intent: IntentAnalysis): {
  direction: CreativeDirection;
  plan: SkeletonAdaptationPlan;
} {
  const requested = intentWords(intent);
  const ranked = AI_HYBRID_NICHE_CASES
    .map((candidate, index) => ({
      candidate,
      index,
      score: overlap(requested, caseWords(candidate)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return {
    direction: ranked[0].candidate.expectedCreativeDirection,
    plan: EMPTY_SAFE_PLAN,
  };
}
