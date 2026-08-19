import { z } from "zod";

import type { InlineImage } from "@/lib/ai-gateway";
import type { FireworksJsonClient } from "./fireworks-client";
import type { FireworksJsonResult } from "./fireworks-contracts";
import { reasoningEffortFor } from "@/lib/generation/fable-model-policy";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/;
const TAXONOMY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_IMAGE_BYTES = 1024 * 1024;

export const BoundedVisualIssueSchema = z.object({
  code: z.enum(["niche", "fidelity", "quality", "coherence", "originality", "mobile", "wrong_niche", "generic_ai", "overflow", "typography", "geometry", "contrast"]),
  severity: z.enum(["minor", "major", "critical"]),
  viewport: z.enum(["desktop", "mobile", "both"]),
}).strict();

export const FinalVisualVerdictSchema = z.object({
  schemaVersion: z.literal("fable-visual-verdict/1.0").default("fable-visual-verdict/1.0"),
  nicheRecognition: z.number().int().min(1).max(10),
  promptFidelity: z.number().int().min(1).max(10),
  visualQuality: z.number().int().min(1).max(10),
  coherence: z.number().int().min(1).max(10),
  originality: z.number().int().min(1).max(10),
  mobileQuality: z.number().int().min(1).max(10),
  wrongNiche: z.boolean(),
  genericAiStyle: z.boolean(),
  issues: z.array(BoundedVisualIssueSchema).max(8).default([]),
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
    /** Texto medido bajo 2:1 contra el fondo que lo pinta. El crítico aprobó un
     *  menú invisible: una captura no distingue "no hay menú" de "el menú está
     *  ahí y no se ve". */
    readonly unreadableText?: boolean;
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
  // `decision` ya no veta por sí solo: un rechazo tiene que DECIR su motivo, y
  // los motivos son estos tres renglones. Medido: el crítico devolvió las seis
  // notas en 7 o más, sin banderas, y aun así "reject" citando una tipografía
  // que el render midió sana. La política ya impedía que la prosa fabricara una
  // aceptación; esto es el espejo — tampoco puede fabricar un rechazo.
  return [verdict.nicheRecognition, verdict.promptFidelity, verdict.visualQuality, verdict.coherence, verdict.originality, verdict.mobileQuality]
      .every((score) => score >= 7)
    && !verdict.wrongNiche
    && !verdict.genericAiStyle
    && !verdict.issues.some((entry) => entry.severity === "major" || entry.severity === "critical");
}

/** Por qué no firmó, en vocabulario cerrado y sin prosa del modelo. Sin esto,
 * un rechazo por "originalidad: 6" y uno por "contraste ilegible" quedan como
 * el mismo registro — y sólo el segundo se puede reparar. La aceptación exige
 * seis notas >= 7 a la vez, así que una página puede caer sin una sola
 * incidencia: ese caso manda al reparador un resumen vacío. */
export function finalVisualRejectionReasons(verdict: FinalVisualVerdict): string[] {
  if (isFinalVisualAcceptance(verdict)) return [];
  const reasons: string[] = [];
  const scores = [
    ["niche_recognition", verdict.nicheRecognition],
    ["prompt_fidelity", verdict.promptFidelity],
    ["visual_quality", verdict.visualQuality],
    ["coherence", verdict.coherence],
    ["originality", verdict.originality],
    ["mobile_quality", verdict.mobileQuality],
  ] as const;
  for (const [name, score] of scores) if (score < 7) reasons.push(`score:${name}=${score}`);
  if (verdict.decision !== "accept") reasons.push(`decision:${verdict.decision}`);
  if (verdict.wrongNiche) reasons.push("flag:wrong_niche");
  if (verdict.genericAiStyle) reasons.push("flag:generic_ai_style");
  for (const entry of verdict.issues) {
    if (entry.severity === "major" || entry.severity === "critical") reasons.push(`issue:${entry.code}:${entry.severity}`);
  }
  return reasons;
}

/** Las cuatro categorías donde el render MIDE. En ellas el crítico no es una
 *  fuente: es una segunda opinión sobre un hecho que ya tenemos. `undefined`
 *  significa "no se midió", y entonces su palabra se conserva. */
function contradictedByMeasurement(
  code: BoundedVisualIssue["code"],
  deterministic: FinalVisualCriticInput["deterministic"],
): boolean {
  if (code === "overflow") return deterministic.mobileOverflow === false;
  if (code === "typography") return deterministic.weakTypographyHierarchy === false;
  if (code === "geometry") return deterministic.invalidGeometry === false;
  if (code === "contrast") return deterministic.unreadableText === false;
  return false;
}

function withDeterministicFailures(
  candidate: FinalVisualVerdict,
  deterministic: FinalVisualCriticInput["deterministic"],
): FinalVisualVerdict {
  // Medido el 2026-08-19: sobre páginas donde el render reportó cero desborde y
  // cero jerarquía débil, el crítico emitió `typography: critical` dos veces y
  // `mobile: critical` una. Las 31 páginas guardadas de esas corridas miden
  // sanas. Un veto sobre lo que sí tenemos instrumento para ver no se hereda:
  // el comentario de esta política siempre dijo que los deterministas deciden.
  candidate = {
    ...candidate,
    issues: candidate.issues.filter((entry) => !contradictedByMeasurement(entry.code, deterministic)),
  };
  const failures: BoundedVisualIssue[] = [];
  if (deterministic.mobileOverflow) failures.push(issue("overflow", "mobile"));
  if (deterministic.weakTypographyHierarchy) failures.push(issue("typography", "both"));
  if (deterministic.invalidGeometry) failures.push(issue("geometry", "both"));
  if (deterministic.unreadableText === true) failures.push(issue("contrast", "both"));
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
        content: "Return only fable-visual-verdict/1.0. Score the desktop and mobile captures. Each starts at the top of the page and may end at a fixed capture height, so judge what is shown and never penalise the page for content past the cut. Issues may contain only code, severity, and viewport. Never emit copy, HTML, CSS, JS, selectors, URLs, prompts, explanations, or repair instructions.",
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
