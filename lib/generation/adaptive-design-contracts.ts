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

const AdaptivePageDesignProgramObjectSchema = z.object({
  schemaVersion: z.literal("adaptive-page-design/1.0"),
  narrative: z.array(SectionRoleSchema).min(1).max(32),
  direction: CreativeDirectionSchema,
  decisions: z.array(CandidateDecisionSchema).min(1).max(32),
  rhythm: z.enum(["editorial", "cinematic", "playful", "immersive", "conversion", "storytelling"]),
  requiredSignals: TaxonomyListSchema,
  forbiddenSignals: TaxonomyListSchema,
  imageSlots: z.array(BoundedImageRequirementSchema).max(12),
}).strict();

function addAdaptivePageDesignIssues(
  value: z.infer<typeof AdaptivePageDesignProgramObjectSchema>,
  ctx: z.RefinementCtx,
): void {
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
}

export const AdaptivePageDesignProgramSchema = AdaptivePageDesignProgramObjectSchema.superRefine(addAdaptivePageDesignIssues);

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

function literalStringTuple(values: readonly string[]) {
  if (values.length === 0) return z.tuple([]);
  return z.tuple(values.map((value) => z.literal(value)) as [z.ZodLiteral<string>, ...z.ZodLiteral<string>[]]);
}

const ProviderTraitListSchema = z.array(TaxonomySlugSchema).max(8);

function providerDecisionSchema(input: {
  readonly ordinal: number;
  readonly candidateIds: readonly string[];
}) {
  const shared = {
    ordinal: z.literal(input.ordinal),
    usefulTraits: ProviderTraitListSchema.default([]),
    rejectedTraits: ProviderTraitListSchema.default([]),
  };
  const generate = z.object({ ...shared, action: z.literal("generate"), candidateId: z.null().default(null) }).strict();
  if (input.candidateIds.length === 0) return generate;
  const ids = [...new Set(input.candidateIds)].map((candidateId) => CandidateIdSchema.parse(candidateId));
  const candidateId = ids.length === 1
    ? z.literal(ids[0])
    : z.enum(ids as [string, ...string[]]);
  return z.union([
    generate,
    z.object({ ...shared, action: z.literal("reuse"), candidateId }).strict(),
    z.object({ ...shared, action: z.literal("rebuild"), candidateId }).strict(),
  ]);
}

function providerDecisionObject(context: Omit<ContextualContract, "expectedDecisions">) {
  const shape = Object.fromEntries(context.requiredRoles.map((role, ordinal) => [
    `decision_${ordinal}`,
    providerDecisionSchema({
      ordinal,
      candidateIds: context.retrievedCandidates
        .filter((candidate) => candidate.ordinal === ordinal && candidate.role === role)
        .map((candidate) => candidate.candidateId),
    }),
  ]));
  return z.object(shape).strict();
}

function orderedProviderDecisions(
  raw: unknown,
  expectedDecisionCount: number,
): unknown[] | null {
  const rawDecisions = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw)
      : null;
  if (!rawDecisions || rawDecisions.length !== expectedDecisionCount) return null;

  const byOrdinal = new Map<number, unknown>();
  for (const decision of rawDecisions) {
    if (!decision || typeof decision !== "object") return null;
    const ordinal = (decision as { ordinal?: unknown }).ordinal;
    if (!Number.isInteger(ordinal) || (ordinal as number) < 0 || (ordinal as number) >= expectedDecisionCount) return null;
    if (byOrdinal.has(ordinal as number)) return null;
    byOrdinal.set(ordinal as number, decision);
  }
  if (byOrdinal.size !== expectedDecisionCount) return null;
  return Array.from({ length: expectedDecisionCount }, (_, ordinal) => byOrdinal.get(ordinal));
}

function normalizeProviderDecisionEnvelope(
  input: unknown,
  expectedDecisionCount: number,
): unknown {
  if (!input || typeof input !== "object") return input;
  const envelope = input as { schemaVersion?: unknown; decisions?: unknown };
  const ordered = orderedProviderDecisions(envelope.decisions, expectedDecisionCount);
  if (!ordered) return input;

  return {
    schemaVersion: envelope.schemaVersion,
    decisions: Object.fromEntries(
      ordered.map((decision, ordinal) => [`decision_${ordinal}`, decision]),
    ),
  };
}

function canonicalStringList(value: unknown): unknown {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? canonicalTaxonomy(value)
    : value;
}

function normalizeAdaptivePageDesignEnvelope(input: unknown, expectedDecisionCount: number): unknown {
  if (!input || typeof input !== "object") return input;
  const envelope = input as Record<string, unknown>;
  const orderedDecisions = orderedProviderDecisions(envelope.decisions, expectedDecisionCount);
  if (!orderedDecisions) return input;
  const normalizedDecisions: z.infer<typeof CandidateDecisionSchema>[] = [];
  for (const decision of orderedDecisions) {
    try {
      normalizedDecisions.push(normalizedDecision(decision));
    } catch {
      return input;
    }
  }
  const direction = envelope.direction && typeof envelope.direction === "object"
    ? envelope.direction as Record<string, unknown>
    : null;
  const imageSlots = Array.isArray(envelope.imageSlots)
    ? [...envelope.imageSlots].sort((left, right) => {
      const leftIndex = left && typeof left === "object" ? (left as { slotIndex?: unknown }).slotIndex : undefined;
      const rightIndex = right && typeof right === "object" ? (right as { slotIndex?: unknown }).slotIndex : undefined;
      return typeof leftIndex === "number" && typeof rightIndex === "number" ? leftIndex - rightIndex : 0;
    })
    : envelope.imageSlots;
  return {
    ...envelope,
    decisions: normalizedDecisions,
    requiredSignals: canonicalStringList(envelope.requiredSignals),
    forbiddenSignals: canonicalStringList(envelope.forbiddenSignals),
    imageSlots,
    ...(direction ? {
      direction: {
        ...direction,
        requiredVisualSignals: canonicalStringList(direction.requiredVisualSignals),
        forbiddenVisualSignals: canonicalStringList(direction.forbiddenVisualSignals),
      },
    } : {}),
  };
}

function exactDecisionTuple(decisions: readonly z.infer<typeof CandidateDecisionSchema>[]) {
  const schemas = decisions.map((decision) => z.object({
    ordinal: z.literal(decision.ordinal),
    action: z.literal(decision.action),
    candidateId: decision.candidateId === null ? z.null() : z.literal(decision.candidateId),
    usefulTraits: literalStringTuple(decision.usefulTraits),
    rejectedTraits: literalStringTuple(decision.rejectedTraits),
  }).strict());
  if (schemas.length === 0) return z.tuple([]);
  return z.tuple(schemas as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function normalizedDecision(value: unknown): z.infer<typeof CandidateDecisionSchema> {
  const parsed = z.object({
    ordinal: z.number().int().min(0).max(31),
    action: z.enum(["reuse", "rebuild", "generate"]),
    candidateId: CandidateIdSchema.nullable(),
    usefulTraits: ProviderTraitListSchema,
    rejectedTraits: ProviderTraitListSchema,
  }).strict().parse(value);
  const rejectedTraits = canonicalTaxonomy(parsed.rejectedTraits);
  const rejected = new Set(rejectedTraits);
  return CandidateDecisionSchema.parse({
    ...parsed,
    usefulTraits: canonicalTaxonomy(parsed.usefulTraits).filter((trait) => !rejected.has(trait)),
    rejectedTraits,
  });
}

export function createAdaptivePageDesignProgramSchema(context: ContextualContract) {
  const initialRequired = canonicalTaxonomy(context.initialRequiredSignals ?? []);
  const initialForbidden = canonicalTaxonomy(context.initialForbiddenSignals ?? []);
  const validInitialRequired = z.array(TaxonomySlugSchema).max(24).safeParse(initialRequired).success;
  const validInitialForbidden = z.array(TaxonomySlugSchema).max(24).safeParse(initialForbidden).success;
  const providerVisible: z.ZodTypeAny = context.expectedDecisions
    ? AdaptivePageDesignProgramObjectSchema.extend({
      narrative: literalStringTuple(context.requiredRoles),
      decisions: exactDecisionTuple(context.expectedDecisions),
      requiredSignals: literalStringTuple(initialRequired),
      forbiddenSignals: literalStringTuple(initialForbidden),
      direction: CreativeDirectionSchema.extend({
        requiredVisualSignals: literalStringTuple(initialRequired),
        forbiddenVisualSignals: literalStringTuple(initialForbidden),
      }),
    })
    : AdaptivePageDesignProgramObjectSchema;
  return z.preprocess(
    (input) => normalizeAdaptivePageDesignEnvelope(input, context.requiredRoles.length),
    providerVisible,
  ).superRefine((rawValue: unknown, ctx: z.RefinementCtx) => {
    const parsed = AdaptivePageDesignProgramObjectSchema.safeParse(rawValue);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid adaptive page design program" });
      return;
    }
    const value = parsed.data;
    addAdaptivePageDesignIssues(value, ctx);
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
  }) as z.ZodType<z.infer<typeof AdaptivePageDesignProgramSchema>>;
}

export function createCandidateScoutResponseSchema(context: Omit<ContextualContract, "expectedDecisions">) {
  const providerVisible = z.object({
    schemaVersion: z.literal("adaptive-candidate-decisions/1.0").default("adaptive-candidate-decisions/1.0"),
    decisions: providerDecisionObject(context),
  }).strict();
  return z.preprocess(
    (input) => normalizeProviderDecisionEnvelope(input, context.requiredRoles.length),
    providerVisible,
  ).transform((value) => ({
    schemaVersion: value.schemaVersion,
    decisions: context.requiredRoles.map((_, ordinal) => normalizedDecision(value.decisions[`decision_${ordinal}`])),
  })) as z.ZodType<{
    schemaVersion: "adaptive-candidate-decisions/1.0";
    decisions: z.infer<typeof CandidateDecisionSchema>[];
  }>;
}

export type CandidateDecision = z.infer<typeof CandidateDecisionSchema>;
export type CandidateAction = CandidateDecision["action"];
export type BoundedImageRequirement = z.infer<typeof BoundedImageRequirementSchema>;
export type AdaptivePageDesignProgram = z.infer<typeof AdaptivePageDesignProgramSchema>;
