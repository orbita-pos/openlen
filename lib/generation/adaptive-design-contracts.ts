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
  const rejected = new Set(value.rejectedTraits);
  if (value.usefulTraits.some((trait) => rejected.has(trait))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectedTraits"], message: "useful and rejected traits must be disjoint" });
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

function canonicalTaxonomy(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function addCanonicalSignalIssues(
  required: readonly string[],
  forbidden: readonly string[],
  basePath: "direction" | undefined,
  ctx: z.RefinementCtx,
): void {
  const requiredPath = basePath ? [basePath, "requiredVisualSignals"] : ["requiredSignals"];
  const forbiddenPath = basePath ? [basePath, "forbiddenVisualSignals"] : ["forbiddenSignals"];
  if (!sameOrderedValues(required, canonicalTaxonomy(required))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: requiredPath, message: "required signals must use canonical lexical order" });
  }
  if (!sameOrderedValues(forbidden, canonicalTaxonomy(forbidden))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: forbiddenPath, message: "forbidden signals must use canonical lexical order" });
  }
  const forbiddenSet = new Set(forbidden);
  if (required.some((signal) => forbiddenSet.has(signal))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: requiredPath, message: "required and forbidden signals must be disjoint" });
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
  addCanonicalSignalIssues(value.requiredSignals, value.forbiddenSignals, undefined, ctx);
  addCanonicalSignalIssues(value.direction.requiredVisualSignals, value.direction.forbiddenVisualSignals, "direction", ctx);
  if (!sameOrderedValues(value.requiredSignals, value.direction.requiredVisualSignals)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direction", "requiredVisualSignals"], message: "direction and program required signals must match" });
  }
  if (!sameOrderedValues(value.forbiddenSignals, value.direction.forbiddenVisualSignals)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direction", "forbiddenVisualSignals"], message: "direction and program forbidden signals must match" });
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
  readonly initialRequiredSignals?: readonly string[];
  readonly initialForbiddenSignals?: readonly string[];
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
  const initialRequired = canonicalTaxonomy(context.initialRequiredSignals ?? []);
  const initialForbidden = canonicalTaxonomy(context.initialForbiddenSignals ?? []);
  const validInitialRequired = z.array(TaxonomySlugSchema).max(24).safeParse(initialRequired).success;
  const validInitialForbidden = z.array(TaxonomySlugSchema).max(24).safeParse(initialForbidden).success;
  return AdaptivePageDesignProgramSchema.superRefine((value, ctx) => {
    if (JSON.stringify(value.narrative) !== JSON.stringify(context.requiredRoles)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["narrative"], message: "all required roles must be present in order" });
    }
    contextualIssues(value.decisions, context, ctx);
    if (!validInitialRequired || !validInitialForbidden) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredSignals"], message: "initial signals are invalid" });
      return;
    }
    const required = new Set(value.requiredSignals);
    const forbidden = new Set(value.forbiddenSignals);
    const initialRequiredSet = new Set(initialRequired);
    const initialForbiddenSet = new Set(initialForbidden);
    if (initialRequired.some((signal) => initialForbiddenSet.has(signal))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredSignals"], message: "initial required and forbidden signals conflict" });
    }
    if (initialRequired.some((signal) => !required.has(signal))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredSignals"], message: "initial required signals cannot be omitted" });
    }
    if (initialForbidden.some((signal) => !forbidden.has(signal))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["forbiddenSignals"], message: "initial forbidden signals cannot be omitted" });
    }
    if (initialForbidden.some((signal) => required.has(signal))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredSignals"], message: "initial forbidden signals cannot become required" });
    }
    if (value.forbiddenSignals.some((signal) => initialRequiredSet.has(signal))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["forbiddenSignals"], message: "initial required signals cannot become forbidden" });
    }
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
