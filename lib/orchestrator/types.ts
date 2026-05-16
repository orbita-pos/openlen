import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline-step identifiers used across routing, witness, and cost tracking.
// Keep this enum in lockstep with the routing table.
// ─────────────────────────────────────────────────────────────────────────────
export const PipelineStepSchema = z.enum([
  "classify",
  "plan",
  "copy",
  "html",
  "image_hero",
  "image_decorative",
  "refine",
]);
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Intent — output of `classify` step.
// ─────────────────────────────────────────────────────────────────────────────
export const ToneSchema = z.enum([
  "bold",
  "friendly",
  "professional",
  "playful",
  "minimal",
  "technical",
]);
export type Tone = z.infer<typeof ToneSchema>;

export const ComplexitySchema = z.enum(["simple", "standard", "rich"]);
export type Complexity = z.infer<typeof ComplexitySchema>;

export const IntentSchema = z.object({
  industry: z.string().min(1),
  audience: z.string().min(1),
  tone: ToneSchema,
  complexity: ComplexitySchema,
  // Free-form goals extracted from the brief (e.g., "drive signups", "showcase product").
  goals: z.array(z.string()).default([]),
  // Distilled product/brand name when one can be confidently extracted.
  productName: z.string().optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Plan — output of `plan` step. Sequence of sections + visual direction.
// ─────────────────────────────────────────────────────────────────────────────
export const SectionKindSchema = z.enum([
  "hero",
  "features",
  "social_proof",
  "testimonials",
  "pricing",
  "faq",
  "cta",
  "footer",
]);
export type SectionKind = z.infer<typeof SectionKindSchema>;

export const SectionPlanSchema = z.object({
  id: z.string(),
  kind: SectionKindSchema,
  // What this section is supposed to accomplish, in plain language.
  purpose: z.string(),
  // Hints for the copy step — what tone, length, angle.
  copyDirection: z.string(),
});
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const StyleDirectionSchema = z.object({
  palette: z.enum(["mono", "dual-accent", "vibrant", "earthy", "neon"]),
  typography: z.enum(["modern-sans", "editorial-serif", "geometric", "mono"]),
  density: z.enum(["airy", "balanced", "dense"]),
  mood: z.string(),
});
export type StyleDirection = z.infer<typeof StyleDirectionSchema>;

export const ImagePromptSchema = z.object({
  id: z.string(),
  purpose: z.enum(["hero", "decorative", "feature_icon", "background"]),
  prompt: z.string(),
  aspectRatio: z.enum(["1:1", "16:9", "4:3", "3:4", "9:16"]).default("16:9"),
});
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

export const PlanSchema = z.object({
  sections: z.array(SectionPlanSchema).min(1),
  style: StyleDirectionSchema,
  // Global copy direction layered on top of section-level direction.
  copyDirection: z.string(),
  imagePrompts: z.array(ImagePromptSchema),
});
export type Plan = z.infer<typeof PlanSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Copy — output of `copy` step. Concrete text per section.
// ─────────────────────────────────────────────────────────────────────────────
export const SectionCopySchema = z.object({
  sectionId: z.string(),
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  body: z.string().optional(),
  ctas: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
  // For features/testimonials/pricing — flexible bullet items.
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        meta: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default([]),
});
export type SectionCopy = z.infer<typeof SectionCopySchema>;

export const CopySchema = z.object({
  sectionTexts: z.array(SectionCopySchema),
});
export type Copy = z.infer<typeof CopySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generated images.
// ─────────────────────────────────────────────────────────────────────────────
export const GeneratedImageSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  purpose: ImagePromptSchema.shape.purpose,
  prompt: z.string(),
  model: z.string(),
});
export type GeneratedImage = z.infer<typeof GeneratedImageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cost tracking.
// ─────────────────────────────────────────────────────────────────────────────
export const CostBreakdownSchema = z.object({
  total: z.number(),
  classify: z.number(),
  plan: z.number(),
  copy: z.number(),
  html: z.number(),
  images: z.number(),
  refine: z.number(),
});
export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Witness records.
// ─────────────────────────────────────────────────────────────────────────────
export const RoutingDecisionSchema = z.object({
  step: PipelineStepSchema,
  // The model the routing table told us to use, with the rationale.
  model: z.string(),
  reason: z.string(),
  // True when this call is the result of a fallback after a prior failure.
  isFallback: z.boolean().default(false),
  fallbackChain: z.array(z.string()).default([]),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const WitnessRecordSchema = z.object({
  // ISO timestamp of when the call started.
  ts: z.string(),
  generationId: z.string(),
  step: PipelineStepSchema,
  decision: RoutingDecisionSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  // Free-form annotation for special cases ("retry after malformed HTML", etc.)
  note: z.string().optional(),
  // True when MOCK_MODE produced this record.
  mocked: z.boolean(),
});
export type WitnessRecord = z.infer<typeof WitnessRecordSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Final landing-page artifact.
// ─────────────────────────────────────────────────────────────────────────────
export const LandingPageMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  generationId: z.string(),
  generatedAt: z.string(),
  brief: z.string(),
  intent: IntentSchema,
});
export type LandingPageMeta = z.infer<typeof LandingPageMetaSchema>;

export const LandingPageSchema = z.object({
  html: z.string(),
  css: z.string(),
  images: z.array(GeneratedImageSchema),
  meta: LandingPageMetaSchema,
  cost: CostBreakdownSchema,
  // Path (relative to repo root) of the witness JSONL for this generation.
  witnessPath: z.string(),
  // Adaptive routing flag — true when we skipped Kimi planning for a simple brief.
  adaptiveFastPath: z.boolean(),
});
export type LandingPage = z.infer<typeof LandingPageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SSE event types emitted from /api/generate.
// ─────────────────────────────────────────────────────────────────────────────
export type ProgressStatus = "started" | "completed" | "skipped" | "fallback";

export const ProgressEventSchema = z.object({
  type: z.literal("progress"),
  step: PipelineStepSchema,
  status: z.enum(["started", "completed", "skipped", "fallback"]),
  details: z.string().optional(),
  costSoFar: z.number().optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  recoverable: z.boolean(),
  step: PipelineStepSchema.optional(),
});
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const ResultEventSchema = z.object({
  type: z.literal("result"),
  page: LandingPageSchema,
});
export type ResultEvent = z.infer<typeof ResultEventSchema>;

export const SseEventSchema = z.discriminatedUnion("type", [
  ProgressEventSchema,
  ErrorEventSchema,
  ResultEventSchema,
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generation request — body of POST /api/generate.
// ─────────────────────────────────────────────────────────────────────────────
export const GenerateRequestSchema = z.object({
  brief: z.string().min(10).max(4000),
  maxBudget: z.number().positive().max(10).optional(),
  // Force adaptive fast-path on/off. When omitted, the orchestrator decides.
  fastPath: z.boolean().optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
