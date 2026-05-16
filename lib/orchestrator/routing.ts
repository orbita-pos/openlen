import type { AnyModelId, ImageModelId, TextModelId } from "@/lib/together/models";
import type { PipelineStep, RoutingDecision } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Routing table — single source of truth for model selection across the
// pipeline. Pipeline step files NEVER hardcode a model ID; they call
// `pickModel(step, ctx)` which consults this table.
//
// Each entry has:
//   - `primary` model and the reason we picked it
//   - `fallbacks[]` chain in priority order
//   - optional `fastPath` override for the adaptive routing logic
//
// When you change pricing or model availability, edit this file and
// `lib/together/models.ts` — nothing else should need touching.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelEntry {
  model: AnyModelId;
  reason: string;
}

export interface StepRouting {
  primary: ModelEntry;
  fallbacks: ModelEntry[];
  /** Optional shortcut for adaptive routing (simple briefs). */
  fastPath?: ModelEntry;
}

export const ROUTING_TABLE: Record<PipelineStep, StepRouting> = {
  classify: {
    primary: {
      model: "lfm2-24b-a2b",
      reason: "Cheap classifier — input/output structure is small and well-typed.",
    },
    fallbacks: [
      {
        model: "moonshotai/Kimi-K2.6",
        reason: "Fallback if lfm2 returns invalid JSON; cached input keeps cost low.",
      },
    ],
  },
  plan: {
    // Plan needs structured output across many fields. LFM2 fastpath was
    // unreliable in practice (failed validation 5/5 times during wire-up) so
    // we removed it; Kimi K2.6 is the default. Re-enable fastPath once we have
    // a tighter LFM2 plan prompt that validates consistently.
    primary: {
      model: "moonshotai/Kimi-K2.6",
      reason: "Mid-tier reasoning workhorse — best price/quality for section planning.",
    },
    fallbacks: [
      {
        model: "glm-5.1",
        reason: "Heavier reasoning when Kimi's plan misses sections or is shallow.",
      },
    ],
  },
  copy: {
    primary: {
      model: "moonshotai/Kimi-K2.6",
      reason: "Best balance of cost and voice control for long-form section copy.",
    },
    fallbacks: [
      {
        model: "glm-5.1",
        reason: "Switch when Kimi copy reads generic — glm-5.1 handles brand voice better in hard cases.",
      },
    ],
  },
  html: {
    primary: {
      model: "qwen3-coder-480b",
      reason: "Strong code synthesis (480B MoE) — workhorse for HTML/CSS at $2/$2 per M tokens.",
    },
    fallbacks: [
      {
        model: "deepseek-ai/DeepSeek-V4-Pro",
        reason:
          "Hard-fix fallback: 80.6% SWE-bench, 93.5% LiveCodeBench. Trigger when Qwen3-Coder output fails quality gates.",
      },
    ],
  },
  refine: {
    primary: {
      model: "qwen3-235b-tput",
      reason: "Cheap throughput-tier — surgical patches don't need a 480B model.",
    },
    fallbacks: [
      {
        model: "qwen3-coder-480b",
        reason: "Promote to the coder model when the patch is structural, not a string swap.",
      },
    ],
  },
  image_hero: {
    primary: {
      model: "FLUX.2-pro",
      reason: "HD hero imagery with legible text — best of the FLUX.2 family for brand-rich prompts.",
    },
    fallbacks: [
      {
        model: "FLUX.2-flex",
        reason: "Drop to FLUX.2-flex (same price) if pro is busy rather than fail the whole page.",
      },
    ],
  },
  image_decorative: {
    primary: {
      model: "FLUX.2-flex",
      reason:
        "FLUX.2-flex shares the FLUX.2 family aesthetic with the hero and accepts the same 1024×1024 sizing — Wan2.6 was dropped because its 1265-1440 area constraint complicated dimension handling.",
    },
    fallbacks: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive routing — decide if a brief qualifies for the fast path.
// ─────────────────────────────────────────────────────────────────────────────

export function shouldUseFastPath(brief: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  const wordCount = brief.split(/\s+/).filter(Boolean).length;
  if (wordCount > 50) return false;
  // Heuristic: a brief that explicitly mentions sections, pricing tiers, or
  // testimonials is not "simple" even if short.
  if (/pricing|testimonial|enterprise|sso|compliance/i.test(brief)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve a model for a step. `pickModel` is what pipeline code calls; it
// emits a `RoutingDecision` that the witness recorder logs verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface PickContext {
  step: PipelineStep;
  /** When true, prefer the fastPath entry if defined. */
  fastPath?: boolean;
  /** When provided, force a specific fallback index instead of primary. */
  fallbackIndex?: number;
  /** Optional override reason — used by retry callers. */
  reasonOverride?: string;
}

export function pickModel(ctx: PickContext): RoutingDecision {
  const entry = ROUTING_TABLE[ctx.step];
  if (!entry) {
    throw new Error(`No routing entry for step "${ctx.step}"`);
  }

  if (ctx.fallbackIndex !== undefined) {
    const fallback = entry.fallbacks[ctx.fallbackIndex];
    if (!fallback) {
      throw new Error(
        `No fallback at index ${ctx.fallbackIndex} for step "${ctx.step}"`,
      );
    }
    return {
      step: ctx.step,
      model: fallback.model,
      reason: ctx.reasonOverride ?? fallback.reason,
      isFallback: true,
      fallbackChain: [entry.primary.model, ...entry.fallbacks.slice(0, ctx.fallbackIndex + 1).map((f) => f.model)],
    };
  }

  if (ctx.fastPath && entry.fastPath) {
    return {
      step: ctx.step,
      model: entry.fastPath.model,
      reason: ctx.reasonOverride ?? entry.fastPath.reason,
      isFallback: false,
      fallbackChain: [],
    };
  }

  return {
    step: ctx.step,
    model: entry.primary.model,
    reason: ctx.reasonOverride ?? entry.primary.reason,
    isFallback: false,
    fallbackChain: [],
  };
}

// Convenience accessors with the right ID type for the call site. Pipeline
// code can ask for "give me a text model" or "give me an image model" and the
// type system won't let us cross the streams.

export function pickTextModel(ctx: PickContext): RoutingDecision & {
  model: TextModelId;
} {
  const decision = pickModel(ctx);
  if (decision.step === "image_hero" || decision.step === "image_decorative") {
    throw new Error(`pickTextModel called for image step ${decision.step}`);
  }
  return decision as RoutingDecision & { model: TextModelId };
}

export function pickImageModel(ctx: PickContext): RoutingDecision & {
  model: ImageModelId;
} {
  const decision = pickModel(ctx);
  if (decision.step !== "image_hero" && decision.step !== "image_decorative") {
    throw new Error(`pickImageModel called for text step ${decision.step}`);
  }
  return decision as RoutingDecision & { model: ImageModelId };
}

/** How many fallback models exist for a step. Used by retry loops to know
 *  when to stop attempting fallbacks. */
export function fallbackCount(step: PipelineStep): number {
  return ROUTING_TABLE[step].fallbacks.length;
}
