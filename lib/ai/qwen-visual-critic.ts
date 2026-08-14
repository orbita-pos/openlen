import { z } from "zod";

import type { InlineImage } from "@/lib/ai-gateway";
import type { FireworksJsonClient } from "./fireworks-client";
import type { FireworksJsonResult } from "./fireworks-contracts";
import { reasoningEffortFor } from "@/lib/generation/fable-model-policy";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/;
const TAXONOMY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_IMAGE_BYTES = 1024 * 1024;

export const BoundedVisualIssueSchema = z.object({
  code: z.enum(["niche", "fidelity", "quality", "coherence", "originality", "mobile", "wrong_niche", "generic_ai", "overflow", "typography", "geometry"]),
  severity: z.enum(["minor", "major", "critical"]),
  viewport: z.enum(["desktop", "mobile", "both"]),
}).strict();

export const FinalVisualVerdictSchema = z.object({
  schemaVersion: z.literal("fable-visual-verdict/1.0"),
  nicheRecognition: z.number().int().min(1).max(10),
  promptFidelity: z.number().int().min(1).max(10),
  visualQuality: z.number().int().min(1).max(10),
  coherence: z.number().int().min(1).max(10),
  originality: z.number().int().min(1).max(10),
  mobileQuality: z.number().int().min(1).max(10),
  wrongNiche: z.boolean(),
  genericAiStyle: z.boolean(),
  issues: z.array(BoundedVisualIssueSchema).max(8),
  decision: z.enum(["accept", "repair", "reject"]),
}).strict();

export type BoundedVisualIssue = z.infer<typeof BoundedVisualIssueSchema>;
export type FinalVisualVerdict = z.infer<typeof FinalVisualVerdictSchema>;

export interface FinalVisualCriticInput {
  readonly requestId: string;
  readonly brief: {
    readonly niche: string;
    readonly requiredSignals: readonly string[];
    readonly forbiddenSignals: readonly string[];
  };
  readonly screenshots: { readonly desktop: InlineImage; readonly mobile: InlineImage };
  readonly deterministic: {
    readonly mobileOverflow: boolean;
    readonly weakTypographyHierarchy: boolean;
    readonly invalidGeometry: boolean;
  };
}

export interface FinalVisualCriticDependencies {
  readonly client: FireworksJsonClient;
}

type ProviderFailure = Extract<FireworksJsonResult<never>, { ok: false }>;
export type FinalVisualCriticResult = ProviderFailure | {
  readonly ok: true;
  readonly verdict: FinalVisualVerdict;
  readonly modelId: string;
  readonly usage: Extract<FireworksJsonResult<unknown>, { ok: true }>['usage'];
  readonly durationMs: number;
  readonly attempts: 1 | 2;
} | { readonly ok: false; readonly code: "invalid_input" };

function validImage(image: InlineImage): boolean {
  if (image.mimeType !== "image/jpeg" || !image.dataBase64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64)) return false;
  const bytes = Buffer.from(image.dataBase64, "base64");
  return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES && bytes.toString("base64") === image.dataBase64;
}

function canonicalSignals(values: readonly string[]): string[] | null {
  if (values.length > 12 || values.some((value) => !TAXONOMY.test(value))) return null;
  const canonical = [...new Set(values)].sort();
  return canonical.length === values.length ? canonical : null;
}

function issue(code: BoundedVisualIssue["code"], viewport: BoundedVisualIssue["viewport"]): BoundedVisualIssue {
  return { code, severity: "critical", viewport };
}

/** Binding release policy. Minor observations are allowed; weak scores and
 * material issues can never be converted into an acceptance by model prose. */
export function isFinalVisualAcceptance(verdict: FinalVisualVerdict): boolean {
  return verdict.decision === "accept"
    && [verdict.nicheRecognition, verdict.promptFidelity, verdict.visualQuality, verdict.coherence, verdict.originality, verdict.mobileQuality]
      .every((score) => score >= 7)
    && !verdict.wrongNiche
    && !verdict.genericAiStyle
    && !verdict.issues.some((entry) => entry.severity === "major" || entry.severity === "critical");
}

function withDeterministicFailures(
  candidate: FinalVisualVerdict,
  deterministic: FinalVisualCriticInput["deterministic"],
): FinalVisualVerdict {
  const failures: BoundedVisualIssue[] = [];
  if (deterministic.mobileOverflow) failures.push(issue("overflow", "mobile"));
  if (deterministic.weakTypographyHierarchy) failures.push(issue("typography", "both"));
  if (deterministic.invalidGeometry) failures.push(issue("geometry", "both"));
  const disqualifiesAcceptance = candidate.wrongNiche
    || candidate.genericAiStyle
    || failures.length > 0
    || (candidate.decision === "accept" && !isFinalVisualAcceptance(candidate));
  if (!disqualifiesAcceptance) return candidate;
  const merged = [...candidate.issues, ...failures].filter((entry, index, values) => values.findIndex((other) => other.code === entry.code && other.viewport === entry.viewport) === index).slice(0, 8);
  return { ...candidate, issues: merged, decision: "reject" };
}

/**
 * Qwen only receives the allowlisted creative signals plus the decoded final
 * viewport bytes. It cannot receive document bytes, copy values, storage URLs,
 * or repair proposals through this boundary.
 */
export async function assessFinalVisualCandidate(
  input: FinalVisualCriticInput,
  deps: FinalVisualCriticDependencies,
): Promise<FinalVisualCriticResult> {
  const requiredSignals = canonicalSignals(input.brief.requiredSignals);
  const forbiddenSignals = canonicalSignals(input.brief.forbiddenSignals);
  const valid = {
    requestId: REQUEST_ID.test(input.requestId), niche: TAXONOMY.test(input.brief.niche), required: requiredSignals !== null,
    forbidden: forbiddenSignals !== null, disjoint: requiredSignals !== null && forbiddenSignals !== null && !requiredSignals.some((signal) => forbiddenSignals.includes(signal)),
    desktop: validImage(input.screenshots.desktop), mobile: validImage(input.screenshots.mobile),
  };
  if (Object.values(valid).some((value) => !value)) return { ok: false, code: "invalid_input" };

  const summary = JSON.stringify({
    schemaVersion: "fable-final-visual-brief/1.0",
    niche: input.brief.niche,
    requiredSignals,
    forbiddenSignals,
  });
  const result = await deps.client.request({
    role: "visual_critic",
    reasoningEffort: reasoningEffortFor("visual_critic", "final_scoring"),
    requestId: `${input.requestId}.final`,
    maxOutputTokens: 2048,
    responseSchema: FinalVisualVerdictSchema,
    messages: [
      {
        role: "system",
        content: "Return only fable-visual-verdict/1.0. Score the complete desktop and mobile page. Issues may contain only code, severity, and viewport. Never emit copy, HTML, CSS, JS, selectors, URLs, prompts, explanations, or repair instructions.",
      },
      { role: "user", content: [{ type: "text", text: JSON.stringify({ brief: JSON.parse(summary), viewport: "desktop" }) }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.screenshots.desktop.dataBase64}` } }] },
      { role: "user", content: [{ type: "text", text: JSON.stringify({ viewport: "mobile" }) }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.screenshots.mobile.dataBase64}` } }] },
    ],
  });
  if (!result.ok) return result;
  return {
    ok: true,
    verdict: withDeterministicFailures(result.value, input.deterministic),
    modelId: result.modelId,
    usage: result.usage,
    durationMs: result.durationMs,
    attempts: result.attempts,
  };
}
