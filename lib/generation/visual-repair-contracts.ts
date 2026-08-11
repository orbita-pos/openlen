import { z } from "zod";

export const VISUAL_QUALITY_VERDICT_VERSION = "visual-quality-verdict/2.1" as const;

export const VisualNonrepairableReasonSchema = z.enum([
  "none",
  "primary_content_absent",
  "primary_content_hidden",
  "structurally_unusable",
]);

export const VISUAL_REPAIR_ISSUE_CODES = [
  "theme_mismatch",
  "palette_mismatch",
  "weak_typography_hierarchy",
  "spacing_density",
  "mobile_overflow",
  "imagery_mismatch",
  "component_treatment_mismatch",
] as const;

export const VisualRepairIssueCodeSchema = z.enum(VISUAL_REPAIR_ISSUE_CODES);

export const VisualQualityScoresSchema = z.object({
  themeRecognition: z.number().int().min(1).max(10),
  visualHierarchy: z.number().int().min(1).max(10),
  componentCoherence: z.number().int().min(1).max(10),
  mobileReadability: z.number().int().min(1).max(10),
  imageryRelevance: z.number().int().min(1).max(10),
  briefAdherence: z.number().int().min(1).max(10),
}).strict();

const SAFE_EXPLANATION = /^(?!.*(?:<|>|https?:\/\/|www\.|[{}]|;))[\p{L}\p{N}\p{P}\p{Zs}\r\n]+$/u;
const SAFE_HOOK_ID = /^[a-z0-9][a-z0-9:_-]{0,79}$/;

export const VisualRepairIssueSchema = z.object({
  code: VisualRepairIssueCodeSchema,
  severity: z.enum(["warning", "critical"]),
  hookId: z.string().regex(SAFE_HOOK_ID).nullable(),
  explanation: z.string().min(1).max(180).regex(SAFE_EXPLANATION),
}).strict();

export const VisualQualityVerdictSchema = z.object({
  schemaVersion: z.literal(VISUAL_QUALITY_VERDICT_VERSION),
  decision: z.enum(["keep", "repair", "nonrepairable"]),
  nonrepairableReason: VisualNonrepairableReasonSchema,
  scores: VisualQualityScoresSchema,
  issues: z.array(VisualRepairIssueSchema).max(12),
}).strict().superRefine((value, ctx) => {
  const minScore = Math.min(...Object.values(value.scores));
  if (value.decision === "keep" && (value.nonrepairableReason !== "none" || value.issues.length > 0 || minScore < 7)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "keep requires satisfied scores and no issues",
    });
  }
  if (value.decision === "repair" && (value.nonrepairableReason !== "none" || value.issues.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "repair requires repairable issues only",
    });
  }
  if (value.decision === "nonrepairable" && (value.nonrepairableReason === "none" || minScore > 3)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "nonrepairable requires a typed reason and visible failure score",
    });
  }
});

export type VisualRepairIssueCode = z.infer<typeof VisualRepairIssueCodeSchema>;
export type VisualRepairIssue = z.infer<typeof VisualRepairIssueSchema>;
export type VisualNonrepairableReason = z.infer<typeof VisualNonrepairableReasonSchema>;
export type VisualQualityScores = z.infer<typeof VisualQualityScoresSchema>;
export type VisualQualityVerdict = z.infer<typeof VisualQualityVerdictSchema>;
