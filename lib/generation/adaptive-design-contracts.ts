import { z } from "zod";

import { CreativeDirectionSchema } from "./creative-contracts";
import { TaxonomySlugSchema } from "./contracts";
import { CANONICAL_SECTION_ROLES } from "./structural-taxonomy";

const SectionRoleSchema = z.enum(CANONICAL_SECTION_ROLES as unknown as [
  (typeof CANONICAL_SECTION_ROLES)[number],
  ...(typeof CANONICAL_SECTION_ROLES)[number][],
]);
const CandidateIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const TaxonomyListSchema = z.array(TaxonomySlugSchema).max(12).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "taxonomy values must be unique" });
  }
});

export const CandidateDecisionSchema = z.object({
  ordinal: z.number().int().min(0).max(31),
  action: z.enum(["reuse", "rebuild", "generate"]),
  candidateId: CandidateIdSchema.nullable(),
  usefulTraits: z.array(TaxonomySlugSchema).max(8),
  rejectedTraits: z.array(TaxonomySlugSchema).max(8),
}).strict().superRefine((value, ctx) => {
  if (value.action === "generate" && value.candidateId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidateId"], message: "generate cannot reference a candidate" });
  }
  if (value.action !== "generate" && value.candidateId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidateId"], message: "reuse and rebuild require a candidate" });
  }
  for (const key of ["usefulTraits", "rejectedTraits"] as const) {
    if (new Set(value[key]).size !== value[key].length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "traits must be unique" });
    }
  }
});

export const BoundedImageRequirementSchema = z.object({
  slotIndex: z.number().int().min(0).max(11),
  ordinal: z.number().int().min(0).max(31),
  mediaType: z.enum(["photo", "illustration", "texture"]),
  subject: TaxonomySlugSchema,
  purpose: TaxonomySlugSchema,
  required: z.boolean(),
}).strict();

function addAlignedDecisionIssues(
  decisions: readonly z.infer<typeof CandidateDecisionSchema>[],
  ctx: z.RefinementCtx,
): void {
  const ordinals = decisions.map((decision) => decision.ordinal);
  if (new Set(ordinals).size !== ordinals.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions"], message: "decision ordinals must be unique" });
  }
  ordinals.forEach((ordinal, index) => {
    if (ordinal !== index) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions", index, "ordinal"], message: "decision ordinals must be contiguous and ordered" });
    }
  });
  const candidateIds = decisions.flatMap((decision) => decision.candidateId === null ? [] : [decision.candidateId]);
  if (new Set(candidateIds).size !== candidateIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions"], message: "candidate IDs must be unique" });
  }
}

export const AdaptivePageDesignProgramSchema = z.object({
  schemaVersion: z.literal("adaptive-page-design/1.0"),
  narrative: z.array(SectionRoleSchema).min(1).max(32),
  direction: CreativeDirectionSchema,
  decisions: z.array(CandidateDecisionSchema).min(1).max(32),
  rhythm: z.enum(["editorial", "cinematic", "playful", "immersive", "conversion", "storytelling"]),
  requiredSignals: TaxonomyListSchema,
  forbiddenSignals: TaxonomyListSchema,
  imageSlots: z.array(BoundedImageRequirementSchema).max(12),
}).strict().superRefine((value, ctx) => {
  addAlignedDecisionIssues(value.decisions, ctx);
  if (value.narrative.length !== value.decisions.length || new Set(value.narrative).size !== value.narrative.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["narrative"], message: "narrative and decisions must be aligned and roles unique" });
  }
  const slotIndexes = value.imageSlots.map((slot) => slot.slotIndex);
  if (new Set(slotIndexes).size !== slotIndexes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageSlots"], message: "image slot indexes must be unique" });
  }
  value.imageSlots.forEach((slot, index) => {
    if (slot.ordinal >= value.narrative.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageSlots", index, "ordinal"], message: "image slot role is missing" });
    }
  });
  const forbidden = new Set(value.forbiddenSignals);
  if (value.requiredSignals.some((signal) => forbidden.has(signal))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredSignals"], message: "required and forbidden signals must be disjoint" });
  }
});

export interface RetrievedCandidateReference {
  readonly candidateId: string;
  readonly ordinal: number;
  readonly role: (typeof CANONICAL_SECTION_ROLES)[number];
}

interface ContextualContract {
  readonly requiredRoles: readonly (typeof CANONICAL_SECTION_ROLES)[number][];
  readonly retrievedCandidates: readonly RetrievedCandidateReference[];
  readonly expectedDecisions?: readonly z.infer<typeof CandidateDecisionSchema>[];
}

function contextualIssues(
  decisions: readonly z.infer<typeof CandidateDecisionSchema>[],
  context: ContextualContract,
  ctx: z.RefinementCtx,
): void {
  const candidates = new Map(context.retrievedCandidates.map((candidate) => [candidate.candidateId, candidate]));
  decisions.forEach((decision, index) => {
    if (decision.candidateId === null) return;
    const candidate = candidates.get(decision.candidateId);
    if (!candidate || candidate.ordinal !== decision.ordinal || candidate.role !== context.requiredRoles[decision.ordinal]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions", index, "candidateId"], message: "candidate is outside the retrieved role set" });
    }
  });
  if (context.expectedDecisions && JSON.stringify(decisions) !== JSON.stringify(context.expectedDecisions)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions"], message: "page planner cannot mutate visual-scout decisions" });
  }
}

export function createAdaptivePageDesignProgramSchema(context: ContextualContract) {
  return AdaptivePageDesignProgramSchema.superRefine((value, ctx) => {
    if (JSON.stringify(value.narrative) !== JSON.stringify(context.requiredRoles)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["narrative"], message: "all required roles must be present in order" });
    }
    contextualIssues(value.decisions, context, ctx);
  });
}

const CandidateScoutResponseSchema = z.object({
  schemaVersion: z.literal("adaptive-candidate-decisions/1.0"),
  decisions: z.array(CandidateDecisionSchema).min(1).max(32),
}).strict();

export function createCandidateScoutResponseSchema(context: Omit<ContextualContract, "expectedDecisions">) {
  return CandidateScoutResponseSchema.superRefine((value, ctx) => {
    addAlignedDecisionIssues(value.decisions, ctx);
    if (value.decisions.length !== context.requiredRoles.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions"], message: "every required role needs one decision" });
    }
    contextualIssues(value.decisions, context, ctx);
  });
}

export type CandidateDecision = z.infer<typeof CandidateDecisionSchema>;
export type CandidateAction = CandidateDecision["action"];
export type BoundedImageRequirement = z.infer<typeof BoundedImageRequirementSchema>;
export type AdaptivePageDesignProgram = z.infer<typeof AdaptivePageDesignProgramSchema>;
