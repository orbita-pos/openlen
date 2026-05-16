// ─────────────────────────────────────────────────────────────────────────────
// Together AI model catalog + pricing (May 2026).
//
// Model IDs below reflect what is currently on docs.together.ai. If a deploy
// fails with "model not found," verify the slug there before changing anything
// else — Together occasionally appends/changes suffixes (e.g. -Instruct, -FP8).
//
// Prices are USD per 1M tokens for text models and USD per image for image
// models. Keep this file in sync with the routing table — every model
// referenced from routing.ts must be defined here.
// ─────────────────────────────────────────────────────────────────────────────

export type TextModelId =
  | "lfm2-24b-a2b"
  | "moonshotai/Kimi-K2.6"
  | "glm-5.1"
  | "Qwen/Qwen3-Coder-Next-FP8"
  | "Qwen/Qwen3.5-9B-FP8"
  | "deepseek-ai/DeepSeek-V4-Pro";

export type ImageModelId = "FLUX.2-pro" | "Wan-2.6-Image";

export type AnyModelId = TextModelId | ImageModelId;

export type TextModelPricing = {
  kind: "text";
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** Best-known context window — used by the planner to cap prompt size. */
  contextWindow: number;
  /** Whether Together AI's prompt-cache (`cache_control: ephemeral`) applies. */
  supportsPromptCache: boolean;
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
    supportsPromptCache: true,
    description: "Cheap, fast intent classifier; perfect for short structured outputs.",
  },
  "moonshotai/Kimi-K2.6": {
    kind: "text",
    inputPerMillion: 1.2,
    outputPerMillion: 4.5,
    contextWindow: 128_000,
    supportsPromptCache: true,
    description: "Mid-tier reasoning workhorse — section planning & long-form copy.",
  },
  "glm-5.1": {
    kind: "text",
    inputPerMillion: 1.4,
    outputPerMillion: 4.4,
    contextWindow: 128_000,
    supportsPromptCache: true,
    description: "754B reasoning alternative when Kimi underperforms on hard briefs.",
  },
  "Qwen/Qwen3-Coder-Next-FP8": {
    kind: "text",
    inputPerMillion: 0.5,
    outputPerMillion: 1.2,
    contextWindow: 131_072,
    supportsPromptCache: true,
    description: "Primary HTML/CSS generator — strong code synthesis, cheap.",
  },
  "Qwen/Qwen3.5-9B-FP8": {
    kind: "text",
    inputPerMillion: 0.1,
    outputPerMillion: 0.15,
    contextWindow: 32_768,
    supportsPromptCache: false,
    description: "Tiny patch model for refine/apply diffs — extremely cheap.",
  },
  "deepseek-ai/DeepSeek-V4-Pro": {
    kind: "text",
    inputPerMillion: 2.1,
    outputPerMillion: 4.4,
    contextWindow: 200_000,
    supportsPromptCache: true,
    description:
      "Hard-fix fallback (80.6% SWE-bench, 93.5% LiveCodeBench). Used only when Qwen3-Coder output fails quality gates.",
  },
  "FLUX.2-pro": {
    kind: "image",
    perImage: 0.03,
    description:
      "HD hero/feature imagery with legible text. 32K context — best for prompts with brand mentions.",
  },
  "Wan-2.6-Image": {
    kind: "image",
    perImage: 0.03,
    description: "Decorative imagery — backgrounds, accents, supporting visuals.",
  },
};

/** Translate our friendly model IDs into the exact slug Together AI expects. */
export function toTogetherSlug(modelId: AnyModelId): string {
  switch (modelId) {
    case "FLUX.2-pro":
      // Together exposes the pro tier as "black-forest-labs/FLUX.2-pro" historically.
      // Verify against docs.together.ai/docs/models before going to production.
      return "black-forest-labs/FLUX.2-pro";
    case "Wan-2.6-Image":
      return "alibaba/Wan-2.6-Image";
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

/** USD cost of a text call. */
export function priceTextCall(
  modelId: TextModelId,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODELS[modelId];
  if (pricing.kind !== "text") {
    throw new Error(`Model ${modelId} is not a text model`);
  }
  const input = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const output = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return input + output;
}

/** USD cost of an image call. */
export function priceImageCall(modelId: ImageModelId, count = 1): number {
  const pricing = MODELS[modelId];
  if (pricing.kind !== "image") {
    throw new Error(`Model ${modelId} is not an image model`);
  }
  return pricing.perImage * count;
}
