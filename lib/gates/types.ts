import { z } from "zod";
import type { BlockId } from "@/lib/blocks/_registry";
import type { FilledBlock, LandingPageMeta } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Quality-gate types.
//
// The six gates run AFTER the deterministic assemble step. Each gate inspects
// the same `GateContext` (html + css + meta + blocks) and returns a typed
// `GateResult` with violations[]. The aggregate runner merges all six into a
// `GatesAggregateResult` the pipeline uses to decide whether to ship or refine.
//
// Severity:
//   - critical → blocks shipping; triggers refine loop (max 2 attempts)
//   - warning  → recorded but doesn't block; surfaces in meta.gateResults
//   - info     → soft signal for analytics
//
// Violations carry an optional `blockIndex` / `blockId` so the refine step can
// target the exact block(s) responsible rather than re-filling everything.
// ─────────────────────────────────────────────────────────────────────────────

export const GATE_IDS = [
  "a11y",
  "conversion",
  "mobile",
  "seo",
  "security",
  "performance",
] as const;

export const GateIdSchema = z.enum(GATE_IDS);
export type GateId = z.infer<typeof GateIdSchema>;

export const SeveritySchema = z.enum(["critical", "warning", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export interface GateViolation {
  gate: GateId;
  severity: Severity;
  /** Block index in blockSequence, if violation maps to a specific block. */
  blockIndex?: number;
  /** Block ID if known. */
  blockId?: BlockId;
  /** Short machine-readable code, e.g. "wcag-2-aa-color-contrast". */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Suggested fix for the refine step. */
  suggestion?: string;
  /** Raw evidence (e.g. axe node, regex match). */
  evidence?: unknown;
}

export interface GateResult {
  gate: GateId;
  passed: boolean;
  violations: GateViolation[];
  /** ms spent in this gate. */
  durationMs: number;
  /** USD cost (only conversion has a nonzero AI-judge cost). */
  cost: number;
}

export type QualityGrade = "passed" | "needs_review" | "warning";

export interface GatesAggregateResult {
  /** True iff every gate passed (no critical violations). */
  passed: boolean;
  /** Critical violations from any gate. */
  criticalViolations: GateViolation[];
  /** All violations (critical + warning + info). */
  allViolations: GateViolation[];
  /** Per-gate results. */
  byGate: Record<GateId, GateResult>;
  /** Total gates cost. */
  totalCost: number;
  /** Total wall-clock ms. */
  totalDurationMs: number;
}

/** Argument passed to each gate runner. */
export interface GateContext {
  html: string;
  css: string;
  meta: LandingPageMeta;
  blockSequence: Array<{ blockId: BlockId; index: number }>;
  /** Filled slots indexed by block sequence index. */
  filledBlocks: FilledBlock[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas for persisted shapes — used by the witness recorder + meta blob.
// ─────────────────────────────────────────────────────────────────────────────

export const GateViolationSchema = z.object({
  gate: GateIdSchema,
  severity: SeveritySchema,
  blockIndex: z.number().int().nonnegative().optional(),
  blockId: z.string().optional(),
  code: z.string(),
  message: z.string(),
  suggestion: z.string().optional(),
  evidence: z.unknown().optional(),
});

export const GateResultSchema = z.object({
  gate: GateIdSchema,
  passed: z.boolean(),
  violations: z.array(GateViolationSchema),
  durationMs: z.number().nonnegative(),
  cost: z.number().nonnegative(),
});

export const GatesAggregateResultSchema = z.object({
  passed: z.boolean(),
  criticalViolations: z.array(GateViolationSchema),
  allViolations: z.array(GateViolationSchema),
  byGate: z.record(GateIdSchema, GateResultSchema),
  totalCost: z.number().nonnegative(),
  totalDurationMs: z.number().nonnegative(),
});

export const QualityGradeSchema = z.enum(["passed", "needs_review", "warning"]);
