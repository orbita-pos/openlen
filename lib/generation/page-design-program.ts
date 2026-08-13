import { z } from "zod";

import type { FireworksJsonClient } from "../ai/fireworks-client";
import type { FireworksJsonResult } from "../ai/fireworks-contracts";
import { createAdaptivePageDesignProgramSchema, type AdaptivePageDesignProgram } from "./adaptive-design-contracts";
import { CreativeDirectionSchema, type CreativeDirection } from "./creative-contracts";
import { TaxonomySlugSchema } from "./contracts";
import { reasoningEffortFor } from "./fable-model-policy";
import type { CanonicalSectionRole } from "./structural-taxonomy";
import type { VisualScoutSuccess } from "./visual-candidate-scout";

const CopyKeySchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_.-]*$/);
const SyntheticIntentSchema = z.object({
  siteType: TaxonomySlugSchema,
  audience: TaxonomySlugSchema,
  domains: z.array(TaxonomySlugSchema).min(1).max(24),
  emotionalGoals: z.array(TaxonomySlugSchema).max(24),
  requiredSignals: z.array(TaxonomySlugSchema).max(24),
  forbiddenSignals: z.array(TaxonomySlugSchema).max(24),
}).strict();
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/;

export interface PageDesignProgramInput {
  readonly scout: VisualScoutSuccess;
  readonly requiredRoles: readonly CanonicalSectionRole[];
  readonly initialDirection: CreativeDirection;
  readonly syntheticIntent: z.infer<typeof SyntheticIntentSchema>;
  readonly copyKeyNames: readonly string[];
  readonly requestId: string;
}

export interface PageDesignProgramDependencies {
  readonly client: FireworksJsonClient;
}

type ProviderFailure = Extract<FireworksJsonResult<never>, { ok: false }>;
export type PageDesignProgramResult = ProviderFailure | { readonly ok: false; readonly code: "invalid_input" } | {
  readonly ok: true;
  readonly program: AdaptivePageDesignProgram;
  readonly modelId: string;
  readonly usage: Extract<FireworksJsonResult<unknown>, { ok: true }>["usage"];
  readonly durationMs: number;
  readonly attempts: 1 | 2;
};

export async function createPageDesignProgram(
  input: PageDesignProgramInput,
  deps: PageDesignProgramDependencies,
): Promise<PageDesignProgramResult> {
  const intent = SyntheticIntentSchema.safeParse(input.syntheticIntent);
  const direction = CreativeDirectionSchema.safeParse(input.initialDirection);
  const copyKeyNames = z.array(CopyKeySchema).max(64).safeParse(input.copyKeyNames);
  if (!REQUEST_ID.test(input.requestId)
    || !intent.success
    || !direction.success
    || !copyKeyNames.success
    || input.requiredRoles.length === 0
    || input.requiredRoles.length > 32
    || new Set(input.requiredRoles).size !== input.requiredRoles.length
    || new Set(copyKeyNames.data).size !== copyKeyNames.data.length
    || input.scout.decisions.length !== input.requiredRoles.length) return { ok: false, code: "invalid_input" };

  const responseSchema = createAdaptivePageDesignProgramSchema({
    requiredRoles: input.requiredRoles,
    retrievedCandidates: input.scout.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      ordinal: candidate.ordinal,
      role: candidate.requestedRole,
    })),
    expectedDecisions: input.scout.decisions,
  });
  const result = await deps.client.request({
    role: "reasoner",
    reasoningEffort: reasoningEffortFor("reasoner", "page_planning"),
    requestId: `${input.requestId}.plan`,
    maxOutputTokens: 8192,
    responseSchema,
    messages: [
      {
        role: "system",
        content: "Return one coherent adaptive-page-design/1.0 program. Preserve the supplied scout decisions exactly. Use only supplied roles, taxonomy slugs, copy-key names, candidate metadata, and bounded image slots. Never emit markup, styles, scripts, selectors, URLs, or copy values.",
      },
      {
        role: "user",
        content: JSON.stringify({
          schemaVersion: "adaptive-page-planner-input/1.0",
          intent: intent.data,
          initialDirection: direction.data,
          requiredRoles: input.requiredRoles,
          scoutDecisions: input.scout.decisions,
          candidates: input.scout.candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            ordinal: candidate.ordinal,
            requestedRole: candidate.requestedRole,
            componentType: candidate.componentType,
            sourceKind: candidate.sourceKind,
            sourceTemplateId: candidate.sourceTemplateId,
            sourceBandOrdinal: candidate.sourceBandOrdinal,
            structuralFingerprint: candidate.structuralFingerprint,
            traits: candidate.traits,
          })),
          copyKeyNames: copyKeyNames.data,
        }),
      },
    ],
  });
  if (!result.ok) return result;
  return {
    ok: true,
    program: result.value,
    modelId: result.modelId,
    usage: result.usage,
    durationMs: result.durationMs,
    attempts: result.attempts,
  };
}
