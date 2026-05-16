// ─────────────────────────────────────────────────────────────────────────────
// Together AI model catalog + pricing.
//
// Verified against `GET https://api.together.xyz/v1/models` on 2026-05-15.
// Slugs below are the exact strings Together expects in `model:` fields.
//
// Pricing in USD per 1M tokens for text models, USD per image for image models.
// `cachedInputPerMillion` is the discounted input rate when Together reports
// `prompt_tokens_details.cached_tokens > 0` — caching is automatic for models
// that support it; no client-side cache_control parameter needed.
//
// Serverless availability matters: some Qwen/DeepSeek tiers require a
// dedicated endpoint and will 400 for casual calls. Every entry below was
// confirmed callable via the serverless tier during Phase 2 wire-up.
// ─────────────────────────────────────────────────────────────────────────────

export type TextModelId =
  | "lfm2-24b-a2b"
  | "moonshotai/Kimi-K2.6"
  | "glm-5.1"
  | "qwen3-coder-480b"
  | "qwen3-235b-tput"
  | "deepseek-ai/DeepSeek-V4-Pro";

export type ImageModelId = "FLUX.2-pro" | "FLUX.2-flex";

export type AnyModelId = TextModelId | ImageModelId;

export type TextModelPricing = {
  kind: "text";
  /** USD per 1M input tokens (uncached). */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** USD per 1M cached input tokens — undefined when the model has no cache discount. */
  cachedInputPerMillion?: number;
  /** Best-known context window — used by the planner to cap prompt size. */
  contextWindow: number;
  /** Short human-readable purpose, surfaced in witness logs. */
  description: string;
};

export type ImageModelPricing = {
  kind: "image";
  /** USD per generated image. */
  perImage: number;
  description: string;
};

export type ModelPricing = TextModelPricing | ImageModelPricing;

export const MODELS: Record<AnyModelId, ModelPricing> = {
  "lfm2-24b-a2b": {
    kind: "text",
    inputPerMillion: 0.03,
    outputPerMillion: 0.12,
    contextWindow: 32_768,
    description: "Cheap, fast intent classifier; perfect for short structured outputs.",
  },
  "moonshotai/Kimi-K2.6": {
    kind: "text",
    inputPerMillion: 1.2,
    outputPerMillion: 4.5,
    cachedInputPerMillion: 0.2,
    contextWindow: 262_144,
    description: "Mid-tier reasoning workhorse — section planning & long-form copy.",
  },
  "glm-5.1": {
    kind: "text",
    inputPerMillion: 1.4,
    outputPerMillion: 4.4,
    contextWindow: 202_752,
    description: "Reasoning alternative when Kimi underperforms on hard briefs.",
  },
  "qwen3-coder-480b": {
    kind: "text",
    inputPerMillion: 2.0,
    outputPerMillion: 2.0,
    contextWindow: 262_144,
    description: "Primary HTML/CSS generator — strong code synthesis (480B MoE).",
  },
  "qwen3-235b-tput": {
    kind: "text",
    inputPerMillion: 0.2,
    outputPerMillion: 0.6,
    contextWindow: 262_144,
    description: "Cheap throughput-tier model for refine/patch passes.",
  },
  "deepseek-ai/DeepSeek-V4-Pro": {
    kind: "text",
    inputPerMillion: 2.1,
    outputPerMillion: 4.4,
    cachedInputPerMillion: 0.2,
    contextWindow: 512_000,
    description:
      "Hard-fix fallback (80.6% SWE-bench, 93.5% LiveCodeBench). Used only when Qwen3-Coder output fails quality gates.",
  },
  "FLUX.2-pro": {
    kind: "image",
    perImage: 0.03,
    description:
      "HD hero/feature imagery with legible text. Best for prompts with brand mentions.",
  },
  "FLUX.2-flex": {
    kind: "image",
    perImage: 0.03,
    description:
      "Same FLUX.2 family as pro at the same price; cheaper inference for decoratives.",
  },
};

/** Translate our friendly model IDs into the exact slug Together AI expects. */
export function toTogetherSlug(modelId: AnyModelId): string {
  switch (modelId) {
    case "lfm2-24b-a2b":
      return "LiquidAI/LFM2-24B-A2B";
    case "glm-5.1":
      return "zai-org/GLM-5.1";
    case "qwen3-coder-480b":
      return "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8";
    case "qwen3-235b-tput":
      return "Qwen/Qwen3-235B-A22B-Instruct-2507-tput";
    case "FLUX.2-pro":
      return "black-forest-labs/FLUX.2-pro";
    case "FLUX.2-flex":
      return "black-forest-labs/FLUX.2-flex";
    default:
      return modelId;
  }
}

export function isTextModel(modelId: AnyModelId): modelId is TextModelId {
  return MODELS[modelId].kind === "text";
}

export function isImageModel(modelId: AnyModelId): modelId is ImageModelId {
  return MODELS[modelId].kind === "image";
}

/**
 * USD cost of a text call. When `cachedInputTokens` is provided and the model
 * has a `cachedInputPerMillion` rate, those tokens bill at the discounted rate
 * and the remaining `inputTokens - cachedInputTokens` bill at the full rate.
 */
export function priceTextCall(
  modelId: TextModelId,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const pricing = MODELS[modelId];
  if (pricing.kind !== "text") {
    throw new Error(`Model ${modelId} is not a text model`);
  }
  const cached = pricing.cachedInputPerMillion !== undefined
    ? Math.min(cachedInputTokens, inputTokens)
    : 0;
  const fresh = inputTokens - cached;
  const inputCost =
    (fresh / 1_000_000) * pricing.inputPerMillion +
    (cached / 1_000_000) * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion);
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/** USD cost of an image call. */
export function priceImageCall(modelId: ImageModelId, count = 1): number {
  const pricing = MODELS[modelId];
  if (pricing.kind !== "image") {
    throw new Error(`Model ${modelId} is not an image model`);
  }
  return pricing.perImage * count;
}
