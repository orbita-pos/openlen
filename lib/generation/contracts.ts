import { z } from "zod";

export const TaxonomySlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

const TaxonomyListSchema = z.array(TaxonomySlugSchema).max(24);

export const IntentAnalysisSchema = z.object({
  schemaVersion: z.literal("intent-analysis/1.0"),
  language: z.string().min(2).max(12),
  functional: z.object({
    siteType: TaxonomySlugSchema,
    requiredSections: TaxonomyListSchema,
    primaryActions: TaxonomyListSchema,
    contentModel: TaxonomySlugSchema,
  }),
  audience: z.object({
    primary: TaxonomySlugSchema,
    ageRange: TaxonomySlugSchema.nullable(),
    secondary: TaxonomyListSchema,
  }),
  domains: TaxonomyListSchema.min(1),
  emotionalGoals: TaxonomyListSchema,
  requiredVisualSignals: TaxonomyListSchema,
  forbiddenVisualSignals: TaxonomyListSchema,
  /** How many photographs the brief actually asks for, null when it says
   * nothing. A count only the user can set: it decides whether the page spends
   * their credits on imagery or leaves that judgement to the page designer. */
  requestedImages: z.number().int().min(0).max(12).nullable().optional(),
  explicitConstraints: z.array(z.string().min(1).max(240)).max(12),
  ambiguities: z.array(z.string().min(1).max(240)).max(12),
  confidence: z.number().min(0).max(1),
});

export type IntentAnalysis = z.infer<typeof IntentAnalysisSchema>;

export const ReasonCodeSchema = z.enum([
  "intent_ambiguous",
  "metadata_missing",
  "metadata_unreviewed",
  "unsupported_site_type",
  "audience_mismatch",
  "domain_incompatible",
  "forbidden_visual_signal",
  "required_asset_unavailable",
  "identity_below_threshold",
  "structure_below_threshold",
  "adaptation_cost_too_high",
  "themeability_below_threshold",
]);

export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const GenerationRouteSchema = z.enum([
  "template_full",
  "template_skeleton",
  "section_composition",
  "scratch_controlled",
  "safe_failure",
]);

export const GenerationDecisionSchema = z.object({
  schemaVersion: z.literal("generation-decision/1.0"),
  route: GenerationRouteSchema,
  templateId: z.string().min(1).nullable(),
  structuralFit: z.number().min(0).max(1),
  identityFit: z.number().min(0).max(1),
  adaptationCost: z.number().min(0).max(1),
  selectedSections: z.array(z.string()),
  rejectedCandidates: z.array(
    z.object({ id: z.string().min(1), reasonCodes: z.array(ReasonCodeSchema) }),
  ),
}).superRefine((value, ctx) => {
  const templateRoute = value.route === "template_full" || value.route === "template_skeleton";
  if (templateRoute && value.templateId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["templateId"], message: "template routes require templateId" });
  }
  if (!templateRoute && value.templateId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["templateId"], message: "non-template routes require null templateId" });
  }
});

export type GenerationDecision = z.infer<typeof GenerationDecisionSchema>;
export type GenerationRoute = z.infer<typeof GenerationRouteSchema>;
