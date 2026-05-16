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
        model: "Qwen/Qwen3.5-9B-FP8",
        reason: "Fallback if lfm2 returns invalid JSON; still cheap, slightly larger.",
      },
    ],
  },
  plan: {
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
    fastPath: {
      model: "lfm2-24b-a2b",
      reason:
        "Adaptive fast path: simple brief (≤50 words, clear intent) → skip Kimi, use cheap classifier to emit a default-shape plan.",
    },
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
      model: "Qwen/Qwen3-Coder-Next-FP8",
      reason: "Strong code synthesis at low cost — the workhorse for HTML/CSS.",
    },
    fallbacks: [
      {
        model: "deepseek-ai/DeepSeek-V4-Pro",
        reason:
          "Hard-fix fallback: 80.6% SWE-bench, 93.5% LiveCodeBench. Trigger when Qwen3-Coder output fails quality gates (malformed tags, unclosed selectors).",
      },
    ],
  },
  refine: {
    primary: {
      model: "Qwen/Qwen3.5-9B-FP8",
      reason: "Tiny patch model — perfect for small edits, copy tweaks, CSS fixes.",
    },
    fallbacks: [
      {
        model: "Qwen/Qwen3-Coder-Next-FP8",
        reason: "Step up when the refine is structural (not just a string swap).",
      },
    ],
  },
  image_hero: {
    primary: {
      model: "FLUX.2-pro",
      reason: "HD hero imagery with legible text — 32K context handles brand-rich prompts.",
    },
    fallbacks: [
      {
        model: "Wan-2.6-Image",
        reason: "Drop to decorative model if FLUX is unavailable rather than fail the whole page.",
      },
    ],
  },
  image_decorative: {
    primary: {
      model: "Wan-2.6-Image",
      reason: "Cheap decorative imagery — backgrounds, accents, supporting visuals.",
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
