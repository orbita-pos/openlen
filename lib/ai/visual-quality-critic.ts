import { GeminiProvider, type StreamEvent, type StreamRequest } from "@/lib/ai-gateway";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import {
  VISUAL_QUALITY_VERDICT_VERSION,
  VisualQualityVerdictSchema,
  type VisualRepairIssueCode,
  type VisualQualityVerdict,
} from "@/lib/generation/visual-repair-contracts";
import type { VisualQualityViewports } from "./visual-quality-renderer";

export const VISUAL_QUALITY_CRITIC_PROMPT_VERSION = "visual-quality-critic/2.2" as const;
export const DEFAULT_VISUAL_QUALITY_CRITIC_TIMEOUT_MS = 18_000;

export interface VisualQualityCriticProviderLike {
  stream(request: StreamRequest, options: { signal?: AbortSignal }): AsyncIterableIterator<StreamEvent>;
}

export interface VisualQualityCriticInput {
  intent: IntentAnalysis;
  direction: CreativeDirection;
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
          explanation: { type: "STRING", maxLength: 180 },
        },
        required: ["code", "severity", "hookId", "explanation"],
      },
    },
  },
  required: ["schemaVersion", "decision", "scores", "issues"],
};

const CANONICAL_ISSUE_EXPLANATIONS: Record<VisualRepairIssueCode, string> = {
  theme_mismatch: "Theme treatment conflicts with the approved creative direction.",
  palette_mismatch: "Palette treatment conflicts with the approved creative direction.",
  weak_typography_hierarchy: "Typography hierarchy conflicts with the approved creative direction.",
  spacing_density: "Spacing density conflicts with the approved creative direction.",
  mobile_overflow: "The mobile render visibly overflows its viewport.",
  imagery_mismatch: "Imagery treatment conflicts with the approved creative direction.",
  component_treatment_mismatch: "Component treatment conflicts with the approved creative direction.",
};

function canonicalizeProviderVerdict(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.issues)) return value;
  const issues = candidate.issues.map((issue) => {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) return issue;
      const record = issue as Record<string, unknown>;
      const explanation = record.explanation;
      const canonical = typeof record.code === "string"
        ? CANONICAL_ISSUE_EXPLANATIONS[record.code as VisualRepairIssueCode]
        : undefined;
      if (!canonical || typeof explanation !== "string" || explanation.length < 1 || explanation.length > 720) return issue;
      return { ...record, explanation: canonical };
    });
  return {
    ...candidate,
    ...(candidate.decision === "keep" && issues.length > 0 ? { decision: "repair" } : {}),
    issues,
  };
}

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
    functional: input.intent.functional,
    domains: input.intent.domains,
    audience: input.intent.audience,
    emotionalGoals: input.intent.emotionalGoals,
    requiredVisualSignals: input.intent.requiredVisualSignals,
    forbiddenVisualSignals: input.intent.forbiddenVisualSignals,
    orderedRoles: input.orderedRoles,
    route: input.route,
    creativeDirection: {
      mode: input.direction.mode,
      visualArchetype: input.direction.visualArchetype,
      emotionalTone: input.direction.emotionalTone,
      palette: input.direction.palette,
      typography: input.direction.typography,
      geometry: input.direction.geometry,
      imagery: input.direction.imagery,
      iconography: input.direction.iconography,
      componentTreatment: input.direction.componentTreatment,
      requiredVisualSignals: input.direction.requiredVisualSignals,
      forbiddenVisualSignals: input.direction.forbiddenVisualSignals,
    },
  };
  return [
    "You are OpenLen's calibrated visual-quality critic.",
    "Judge only visible pixels in the attached desktop and mobile renders against this allowlisted intent projection:",
    JSON.stringify(criticIntent),
    "Decision rubric:",
    "- keep: the visible page communicates the requested domain, audience, emotional tone, required sections and actions; no critical issue remains.",
    "- repair: the visible experience is present and structurally usable, but palette, typography, spacing, imagery or component treatment can be corrected without changing copy or structure.",
    "- nonrepairable: primary content is absent, hidden, blank, structurally unusable, or the requested domain cannot be communicated without changing copy or structure.",
    "A visibly blank, hidden, or missing primary experience is nonrepairable. Never infer invisible content from orderedRoles.",
    "Use repair only when the visible defect can be corrected without changing copy or structure.",
    "Compare the visible output explicitly with every creativeDirection field. keep requires no visible contradiction of the creativeDirection.",
    "A polished page can still require repair when it contradicts the specified palette, typography scale, density, radius, imagery, iconography or component treatment.",
    "Examples: expressive typography is contradicted by near-uniform tiny text; low or low-medium density is contradicted by compressed spacing; round or soft treatment is contradicted by square double-bordered components.",
    "Score each dimension independently from visible evidence. Scores 7-10 mean the requirement is clearly satisfied; scores 1-3 mean it is absent or contradicted.",
    "Return strict JSON matching visual-quality-verdict/2.0. Do not propose HTML, CSS, URLs, copy, or structure changes.",
    "Set every hookId to null. Each issue explanation must be one short sentence of 160 characters or fewer.",
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
  const validated = VisualQualityVerdictSchema.safeParse(canonicalizeProviderVerdict(parsed));
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
