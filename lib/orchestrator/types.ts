import { z } from "zod";
import { BLOCK_IDS, isBlockId } from "@/lib/blocks/_registry";
import type { BlockId } from "@/lib/blocks/_registry";

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline-step identifiers used across routing, witness, and cost tracking.
// Keep this enum in lockstep with the routing table.
// ─────────────────────────────────────────────────────────────────────────────
export const PipelineStepSchema = z.enum([
  "classify",
  "plan",
  "fill",
  "image_hero",
  "image_decorative",
  "assemble",
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
// Aesthetic + palette (re-exported here so consumers don't have to import from
// design-tokens.ts when they only want the schema). Kept as a narrow union so
// the plan step's output can be validated against it.
// ─────────────────────────────────────────────────────────────────────────────
export const AestheticDirectionSchema = z.enum([
  "technical-minimal",
  "refined-editorial",
  "warm-humanist",
  "editorial-maximalist",
  "brutalist-technical",
]);
export type AestheticDirection = z.infer<typeof AestheticDirectionSchema>;

export const PaletteNameSchema = z.enum([
  "mono-dark",
  "indigo-dark",
  "emerald-dark",
  "warm-dark",
  "mono-light",
]);
export type PaletteName = z.infer<typeof PaletteNameSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// BlockId — validated against the runtime registry rather than embedding the
// literal-union in this schema. Importing BlockId from _registry keeps the two
// in sync automatically; the refine() error message tells the plan step's
// validator exactly which value was bad.
// ─────────────────────────────────────────────────────────────────────────────
export const BlockIdSchema = z
  .string()
  .refine((s): s is BlockId => isBlockId(s), {
    message: `Unknown block id. Allowed: ${BLOCK_IDS.join(", ")}`,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Plan — output of `plan` step. An ordered list of block IDs the AI chose
// from the catalog, plus the aesthetic direction the fill+assemble steps must
// honour. The plan step never produces section markup or copy.
// ─────────────────────────────────────────────────────────────────────────────
export const BlockSequenceEntrySchema = z.object({
  blockId: BlockIdSchema,
  // What this block accomplishes on the page — used by fill to steer slot copy.
  purpose: z.string().min(1),
  // Optional override: if the fill step should emphasize specific content for
  // this block (e.g., "highlight enterprise SSO" on a pricing block).
  emphasis: z.string().optional(),
});
export type BlockSequenceEntry = z.infer<typeof BlockSequenceEntrySchema>;

export const PlanSchema = z.object({
  blockSequence: z.array(BlockSequenceEntrySchema).min(2),
  aesthetic: AestheticDirectionSchema,
  palette: PaletteNameSchema,
  // 1-2 sentences explaining why this block sequence vs alternatives.
  rationale: z.string().min(1),
  imageNeeds: z.object({
    hero: z.boolean(),
    decorative: z.number().int().nonnegative().max(6),
  }),
});
export type Plan = z.infer<typeof PlanSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// FilledBlock — one entry per block in plan.blockSequence after the fill step
// produces slot JSON validated by the block's own Zod schema.
// ─────────────────────────────────────────────────────────────────────────────
export const FilledBlockSchema = z.object({
  blockId: BlockIdSchema,
  index: z.number().int().nonnegative(),
  // The slot payload is validated at fill time against the block's slotsSchema.
  // Stored as `unknown` here so this top-level schema doesn't have to know
  // every per-block slot shape; downstream consumers re-parse if they need
  // typed access (the assemble step does this via getBlock(id).meta.slotsSchema).
  slots: z.unknown(),
  fillCost: z.number().nonnegative(),
  fillTokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
});
export type FilledBlock = z.infer<typeof FilledBlockSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generated images.
// ─────────────────────────────────────────────────────────────────────────────
export const ImagePromptSchema = z.object({
  id: z.string(),
  purpose: z.enum(["hero", "decorative", "feature_icon", "background"]),
  prompt: z.string(),
  aspectRatio: z.enum(["1:1", "16:9", "4:3", "3:4", "9:16"]).default("16:9"),
});
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

export const GeneratedImageSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  purpose: ImagePromptSchema.shape.purpose,
  prompt: z.string(),
  model: z.string(),
});
export type GeneratedImage = z.infer<typeof GeneratedImageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cost tracking. `assemble` is always 0 (deterministic), kept in the breakdown
// for symmetry so /api/usage and UI cost charts can show the full pipeline.
// ─────────────────────────────────────────────────────────────────────────────
export const CostBreakdownSchema = z.object({
  total: z.number(),
  classify: z.number(),
  plan: z.number(),
  fill: z.number(),
  images: z.number(),
  assemble: z.number(),
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
  // Free-form annotation for special cases ("retry after malformed JSON", etc.)
  note: z.string().optional(),
  // True when MOCK_MODE produced this record.
  mocked: z.boolean(),
  // Design-engine palette in use when this step ran. Optional because pre-classify
  // calls (and legacy recordings) may not carry it.
  palette: PaletteNameSchema.optional(),
  // Few-shot reference variants injected into the system prompt for this call,
  // in the order they appeared. Format: "direction/variant" (e.g.
  // "technical-minimal/tide"). Absent for steps that skip few-shot (classify,
  // images, assemble) and for legacy recordings predating Session 2.
  fewShotVariants: z.array(z.string()).optional(),
  // Block ID + position for `fill` step records. Present only on per-block
  // fill events so the recording can be filtered/grouped by block.
  blockId: BlockIdSchema.optional(),
  blockIndex: z.number().int().nonnegative().optional(),
  // True on the synthetic `assemble` event written by the deterministic
  // renderer — distinguishes it from LLM-backed records (which have
  // model/tokens/cost). When true, model/tokens/cost are all zero.
  deterministic: z.boolean().optional(),
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
  aesthetic: AestheticDirectionSchema,
  palette: PaletteNameSchema,
  // Trace of which blocks composed this page, in order. Lets the UI surface
  // "this page used hero/centered-cta + features/icon-grid-3col + ..." for
  // explainability without re-reading the witness file.
  blockSequence: z.array(
    z.object({
      blockId: BlockIdSchema,
      index: z.number().int().nonnegative(),
    }),
  ),
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
  // Intermediate artifacts the regenerate endpoint accepts back, mutates one
  // block, and re-runs fill+assemble on. Without surfacing them, the client
  // would have to call the full pipeline to change a single section.
  plan: PlanSchema,
  filledBlocks: z.array(FilledBlockSchema),
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
  // For fill step events: the block index this progress refers to. Lets the
  // client correlate parallel fill_block_N events to specific blocks.
  blockIndex: z.number().int().nonnegative().optional(),
  blockId: BlockIdSchema.optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

// Streamed mid-generation. Lets the client paint intent chips, page
// skeleton copy, and images as soon as each step finishes rather than
// waiting for the final result. `data` is intentionally `unknown` at the
// schema layer — the emitter is typed (see `emitStepResult` in
// _shared.ts) and the consumer narrows on `step` before reading data.
export const StepResultEventSchema = z.object({
  type: z.literal("step_result"),
  step: PipelineStepSchema,
  data: z.unknown(),
});
export type StepResultEvent = z.infer<typeof StepResultEventSchema>;

export type StepResultPayload =
  | { step: "classify"; data: Intent }
  | { step: "plan"; data: Plan }
  | { step: "fill"; data: FilledBlock }
  | { step: "image_hero"; data: GeneratedImage }
  | { step: "image_decorative"; data: GeneratedImage };

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

// Emitted after the result has been persisted to the projects table, so the
// client can hold onto the project id for subsequent regen/edit calls.
export const ProjectSavedEventSchema = z.object({
  type: z.literal("project_saved"),
  projectId: z.string(),
  title: z.string(),
});
export type ProjectSavedEvent = z.infer<typeof ProjectSavedEventSchema>;

export const SseEventSchema = z.union([
  ProgressEventSchema,
  StepResultEventSchema,
  ErrorEventSchema,
  ResultEventSchema,
  ProjectSavedEventSchema,
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
