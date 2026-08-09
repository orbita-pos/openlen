import { GeminiProvider, type StreamEvent, type StreamRequest } from "@/lib/ai-gateway";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import {
  VISUAL_QUALITY_VERDICT_VERSION,
  VisualQualityVerdictSchema,
  type VisualQualityVerdict,
} from "@/lib/generation/visual-repair-contracts";
import type { VisualQualityViewports } from "./visual-quality-renderer";

export const VISUAL_QUALITY_CRITIC_PROMPT_VERSION = "visual-quality-critic/2.0" as const;
export const DEFAULT_VISUAL_QUALITY_CRITIC_TIMEOUT_MS = 18_000;

export interface VisualQualityCriticProviderLike {
  stream(request: StreamRequest, options: { signal?: AbortSignal }): AsyncIterableIterator<StreamEvent>;
}

export interface VisualQualityCriticInput {
  intent: IntentAnalysis;
  orderedRoles: string[];
  route: "template_skeleton" | "section_composition";
  images: VisualQualityViewports | null;
  model: string;
  apiKey?: string;
}

export interface VisualQualityUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
}

export type VisualQualityCriticResult =
  | {
      ok: true;
      verdict: VisualQualityVerdict;
      usage?: VisualQualityUsage;
      durationMs: number;
      promptVersion: typeof VISUAL_QUALITY_CRITIC_PROMPT_VERSION;
      modelId: string;
    }
  | {
      ok: false;
      kind: "missing_api_key" | "render_unavailable" | "timeout" | "provider_error" | "invalid_response";
      usage?: VisualQualityUsage;
      durationMs: number;
      promptVersion: typeof VISUAL_QUALITY_CRITIC_PROMPT_VERSION;
      modelId: string;
    };

export interface VisualQualityCriticInternals {
  provider?: VisualQualityCriticProviderLike;
  providerFactory?: (apiKey: string) => VisualQualityCriticProviderLike;
  timeoutMs?: number;
  now?: () => number;
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING", enum: [VISUAL_QUALITY_VERDICT_VERSION] },
    decision: { type: "STRING", enum: ["keep", "repair", "nonrepairable"] },
    scores: {
      type: "OBJECT",
      properties: Object.fromEntries([
        "themeRecognition", "visualHierarchy", "componentCoherence",
        "mobileReadability", "imageryRelevance", "briefAdherence",
      ].map((key) => [key, { type: "INTEGER", minimum: 1, maximum: 10 }])),
      required: [
        "themeRecognition", "visualHierarchy", "componentCoherence",
        "mobileReadability", "imageryRelevance", "briefAdherence",
      ],
    },
    issues: {
      type: "ARRAY",
      maxItems: 12,
      items: {
        type: "OBJECT",
        properties: {
          code: { type: "STRING", enum: [
            "theme_mismatch", "palette_mismatch", "weak_typography_hierarchy",
            "spacing_density", "mobile_overflow", "imagery_mismatch",
            "component_treatment_mismatch",
          ] },
          severity: { type: "STRING", enum: ["warning", "critical"] },
          hookId: { type: "STRING", nullable: true },
          explanation: { type: "STRING" },
        },
        required: ["code", "severity", "hookId", "explanation"],
      },
    },
  },
  required: ["schemaVersion", "decision", "scores", "issues"],
};

function failure(
  input: VisualQualityCriticInput,
  startedAt: number,
  now: () => number,
  kind: Extract<VisualQualityCriticResult, { ok: false }>["kind"],
  usage?: VisualQualityUsage,
): VisualQualityCriticResult {
  return {
    ok: false,
    kind,
    ...(usage ? { usage: { ...usage } } : {}),
    durationMs: Math.max(0, now() - startedAt),
    promptVersion: VISUAL_QUALITY_CRITIC_PROMPT_VERSION,
    modelId: input.model,
  };
}

function addUsage(current: VisualQualityUsage | undefined, event: Extract<StreamEvent, { type: "usage" }>): VisualQualityUsage {
  return {
    inputTokens: (current?.inputTokens ?? 0) + event.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + event.outputTokens,
    cachedTokens: (current?.cachedTokens ?? 0) + event.cachedTokens,
    thinkingTokens: (current?.thinkingTokens ?? 0) + event.thinkingTokens,
  };
}

function criticPrompt(input: VisualQualityCriticInput): string {
  const criticIntent = {
    domains: input.intent.domains,
    audience: input.intent.audience,
    emotionalGoals: input.intent.emotionalGoals,
    requiredVisualSignals: input.intent.requiredVisualSignals,
    forbiddenVisualSignals: input.intent.forbiddenVisualSignals,
    orderedRoles: input.orderedRoles,
    route: input.route,
  };
  return [
    "You are OpenLen's calibrated visual-quality critic.",
    "Judge the attached desktop and mobile renders only against this allowlisted intent projection:",
    JSON.stringify(criticIntent),
    "Return strict JSON matching visual-quality-verdict/2.0. Do not propose HTML, CSS, URLs, copy, or structure changes.",
  ].join("\n");
}

async function runCritic(
  input: VisualQualityCriticInput,
  provider: VisualQualityCriticProviderLike,
  signal: AbortSignal,
  usageRef: { current?: VisualQualityUsage },
): Promise<{ kind: "success"; verdict: VisualQualityVerdict } | { kind: "provider_error" | "invalid_response" }> {
  let raw = "";
  try {
    for await (const event of provider.stream({
      model: input.model,
      messages: [{ role: "user", content: criticPrompt(input) }],
      images: [input.images!.desktop, input.images!.mobile],
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 2048,
      thinkingBudget: 0,
      temperature: 0,
    }, { signal })) {
      if (event.type === "text_delta") raw += event.text;
      if (event.type === "usage") usageRef.current = addUsage(usageRef.current, event);
      if (event.type === "done" && event.stopReason.kind === "error") return { kind: "provider_error" };
    }
  } catch {
    return { kind: "provider_error" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid_response" };
  }
  const validated = VisualQualityVerdictSchema.safeParse(parsed);
  return validated.success
    ? { kind: "success", verdict: validated.data }
    : { kind: "invalid_response" };
}

export async function critiqueVisualQuality(
  input: VisualQualityCriticInput,
  internals: VisualQualityCriticInternals = {},
): Promise<VisualQualityCriticResult> {
  const now = internals.now ?? Date.now;
  const startedAt = now();
  if (!input.images) return failure(input, startedAt, now, "render_unavailable");

  const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return failure(input, startedAt, now, "missing_api_key");

  let provider: VisualQualityCriticProviderLike;
  try {
    provider = internals.provider
      ?? internals.providerFactory?.(apiKey)
      ?? new GeminiProvider(apiKey);
  } catch {
    return failure(input, startedAt, now, "provider_error");
  }
  const usageRef: { current?: VisualQualityUsage } = {};
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, internals.timeoutMs ?? DEFAULT_VISUAL_QUALITY_CRITIC_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([runCritic(input, provider, controller.signal, usageRef), timeout]);
    if (result === "timeout") return failure(input, startedAt, now, "timeout", usageRef.current);
    if (result.kind !== "success") return failure(input, startedAt, now, result.kind, usageRef.current);
    return {
      ok: true,
      verdict: result.verdict,
      ...(usageRef.current ? { usage: { ...usageRef.current } } : {}),
      durationMs: Math.max(0, now() - startedAt),
      promptVersion: VISUAL_QUALITY_CRITIC_PROMPT_VERSION,
      modelId: input.model,
    };
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
