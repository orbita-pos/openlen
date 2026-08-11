import type { VisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import type { VisualQualityCriticResult, VisualQualityUsage } from "@/lib/ai/visual-quality-critic";
import type { CreativeDirection, SkeletonAdaptationPlan, SkeletonInventory } from "./creative-contracts";
import { buildSkeletonInventory } from "./skeleton-inventory";
import type { IntentAnalysis } from "./contracts";
import type { ApplyVisualRepairResult } from "./apply-visual-repair";
import type { GenerateVisualRepairPlanResult } from "./generate-visual-repair";
import { VisualQualityVerdictSchema, type VisualQualityScores, type VisualQualityVerdict, type VisualRepairIssueCode } from "./visual-repair-contracts";
import type { AssetPipelineMode } from "./asset-pipeline-mode";
import type { AssetResolutionTrace } from "./asset-contracts";

export function shouldAttemptVisualRepair(v: VisualQualityVerdict): boolean { return v.decision === "repair" && v.issues.length > 0; }
export const VISUAL_REPAIR_SCORE_DIMENSIONS = {
  theme_mismatch: ["themeRecognition", "briefAdherence"],
  palette_mismatch: ["themeRecognition", "briefAdherence"],
  weak_typography_hierarchy: ["visualHierarchy"],
  spacing_density: ["visualHierarchy", "componentCoherence"],
  mobile_overflow: ["mobileReadability"],
  imagery_mismatch: ["imageryRelevance", "briefAdherence"],
  component_treatment_mismatch: ["componentCoherence"],
} as const satisfies Record<VisualRepairIssueCode, readonly (keyof VisualQualityScores)[]>;
export function repairImprovesQuality(before: VisualQualityVerdict, after: VisualQualityVerdict): boolean {
  const keys = Object.keys(before.scores) as Array<keyof VisualQualityScores>;
  if (after.issues.some((issue) => issue.severity === "critical")) return false;
  const beforeCodes = new Set(before.issues.map((issue) => issue.code));
  if (after.issues.some((issue) => !beforeCodes.has(issue.code))) return false;
  const criticalBefore = new Set(before.issues.filter((issue) => issue.severity === "critical").map((issue) => issue.code));
  if (after.issues.some((issue) => criticalBefore.has(issue.code))) return false;
  const relevant = new Set<keyof VisualQualityScores>();
  for (const issue of before.issues) for (const key of VISUAL_REPAIR_SCORE_DIMENSIONS[issue.code]) relevant.add(key);
  if ([...relevant].some((key) => after.scores[key] < before.scores[key])) return false;
  const relevantGain = [...relevant].reduce((sum, key) => sum + after.scores[key] - before.scores[key], 0);
  if (relevantGain < 2) return false;
  if (keys.some((key) => !relevant.has(key) && after.scores[key] < before.scores[key] - 1)) return false;
  const totalGain = keys.reduce((sum, key) => sum + after.scores[key] - before.scores[key], 0);
  return totalGain >= 0 && after.scores.themeRecognition >= 7 && after.scores.briefAdherence >= 7;
}
export interface ClosedLoopVisualRepairInput { html: string; metadata: object; sourceId: string; intent: IntentAnalysis; direction: CreativeDirection; route: "template_skeleton" | "section_composition"; assetContext?: { mode: AssetPipelineMode; projectId: string }; assetTraceSink?: (trace: AssetResolutionTrace) => void; brandAccent?: string | null; explicitConstraints?: readonly string[]; timeoutMs?: number }
export interface ClosedLoopVisualRepairDeps {
  buildInventory?: (html: string, sourceId: string) => SkeletonInventory;
  render(html: string, options?: { signal: AbortSignal }): Promise<VisualQualityViewports | null>;
  critic(input: { intent: IntentAnalysis; direction: CreativeDirection; orderedRoles: string[]; route: ClosedLoopVisualRepairInput["route"]; images: VisualQualityViewports }, options?: { signal: AbortSignal }): Promise<VisualQualityCriticResult>;
  generatePlan(input: { direction: CreativeDirection; inventory: SkeletonInventory; verdict: VisualQualityVerdict }, options?: { signal: AbortSignal }): Promise<GenerateVisualRepairPlanResult>;
  applyPlan(input: { html: string; sourceId: string; intent: IntentAnalysis; direction: CreativeDirection; plan: SkeletonAdaptationPlan; assetContext?: { mode: AssetPipelineMode; projectId: string }; assetTraceSink?: (trace: AssetResolutionTrace) => void; brandAccent?: string | null; explicitConstraints?: readonly string[]; issueCodes?: readonly VisualRepairIssueCode[] }, options?: { signal: AbortSignal }): Promise<ApplyVisualRepairResult>;
}
function orderedRoles(html: string): string[] { return [...html.matchAll(/data-openlen-role=["']([^"']+)["']/gi)].map((match) => match[1]!); }
function outputHash(html: string): string { return `sha256:${createHash("sha256").update(html).digest("hex")}`; }
function original(input: ClosedLoopVisualRepairInput, code: string, usage: VisualQualityUsage[] = []) { return { html: input.html, metadata: input.metadata, accepted: false as const, trace: { resultCode: code, usage: usage.map((item) => ({ ...item })) } }; }
const RENDERER_DIAGNOSTICS = {
  mobile_overflow: {
    score: "mobileReadability",
    explanation: "The mobile render visibly overflows its viewport.",
  },
  weak_typography_hierarchy: {
    score: "visualHierarchy",
    explanation: "Typography hierarchy conflicts with the approved creative direction.",
  },
  component_treatment_mismatch: {
    score: "componentCoherence",
    explanation: "Component treatment conflicts with the approved creative direction.",
  },
} as const satisfies Partial<Record<VisualRepairIssueCode, {
  score: keyof VisualQualityScores;
  explanation: string;
}>>;
type RendererDiagnosticCode = keyof typeof RENDERER_DIAGNOSTICS;

function rendererDiagnosticCodes(
  images: VisualQualityViewports,
  direction: CreativeDirection,
): RendererDiagnosticCode[] {
  const codes: RendererDiagnosticCode[] = [];
  if (images.mobileOverflow === true) codes.push("mobile_overflow");
  if (images.weakTypographyHierarchy === true) codes.push("weak_typography_hierarchy");
  if (images.squareComponentTreatment === true && direction.geometry.radius !== "square") {
    codes.push("component_treatment_mismatch");
  }
  return codes;
}

function reconcileRendererDiagnostics(
  verdict: VisualQualityVerdict,
  images: VisualQualityViewports,
  direction: CreativeDirection,
): VisualQualityVerdict {
  if (verdict.decision === "nonrepairable") return verdict;
  const diagnosticCodes = rendererDiagnosticCodes(images, direction);
  if (diagnosticCodes.length === 0) return verdict;
  const diagnosticSet = new Set<VisualRepairIssueCode>(diagnosticCodes);
  const issues = verdict.issues
    .filter((issue) => !diagnosticSet.has(issue.code))
    .slice(0, 12 - diagnosticCodes.length);
  const scores = { ...verdict.scores };
  for (const code of diagnosticCodes) {
    const score = RENDERER_DIAGNOSTICS[code].score;
    scores[score] = Math.min(scores[score], 5);
  }
  return VisualQualityVerdictSchema.parse({
    ...verdict,
    decision: "repair",
    nonrepairableReason: "none",
    scores,
    issues: [...issues, ...diagnosticCodes.map((code) => ({
      code,
      severity: "critical",
      hookId: null,
      explanation: RENDERER_DIAGNOSTICS[code].explanation,
    }))],
  });
}

export async function runClosedLoopVisualRepair(input: ClosedLoopVisualRepairInput, deps: ClosedLoopVisualRepairDeps) {
  const controller = new AbortController();
  const usage: VisualQualityUsage[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const execute = async () => {
    try {
      const boundary = { signal: controller.signal };
      const firstImages = await deps.render(input.html, boundary); if (!firstImages) return original(input, "initial_render_failed", usage);
      const first = await deps.critic({ intent: input.intent, direction: input.direction, orderedRoles: orderedRoles(input.html), route: input.route, images: firstImages }, boundary);
      if (first.usage) usage.push(first.usage);
      if (!first.ok) return original(input, "initial_critic_failed", usage);
      const firstVerdict = reconcileRendererDiagnostics(first.verdict, firstImages, input.direction);
      if (!shouldAttemptVisualRepair(firstVerdict)) return original(input, firstVerdict.decision === "keep" ? "healthy_keep" : "nonrepairable", usage);
      const inventory = (deps.buildInventory ?? buildSkeletonInventory)(input.html, input.sourceId);
      const generated = await deps.generatePlan({ direction: input.direction, inventory, verdict: firstVerdict }, boundary);
      if (generated.usage) usage.push(generated.usage);
      if (!generated.ok) return original(input, "repair_provider_failed", usage);
      const applied = await deps.applyPlan({ html: input.html, sourceId: input.sourceId, intent: input.intent, direction: input.direction, plan: generated.plan, assetContext: input.assetContext, assetTraceSink: input.assetTraceSink, brandAccent: input.brandAccent, explicitConstraints: input.explicitConstraints, issueCodes: firstVerdict.issues.map((issue) => issue.code) }, boundary);
      if (!applied.ok) return original(input, applied.code, usage);
      const finalImages = await deps.render(applied.html, boundary); if (!finalImages) return original(input, "final_render_failed", usage);
      const final = await deps.critic({ intent: input.intent, direction: input.direction, orderedRoles: orderedRoles(applied.html), route: input.route, images: finalImages }, boundary);
      if (final.usage) usage.push(final.usage);
      const finalHasRendererDiagnostics = rendererDiagnosticCodes(finalImages, input.direction).length > 0;
      if (!final.ok || finalHasRendererDiagnostics || !repairImprovesQuality(firstVerdict, final.verdict)) return original(input, !final.ok ? "final_critic_failed" : "not_improved", usage);
      return { html: applied.html, metadata: { ...input.metadata, ...(applied.assetManifest && applied.assetTrace ? { assetManifest: applied.assetManifest, assetTrace: applied.assetTrace } : {}) }, accepted: true as const, trace: {
        resultCode: "accepted", usage: usage.map((item) => ({ ...item })),
        promptVersion: generated.promptVersion, criticVersion: "visual-quality-verdict/2.1" as const,
        issueCodesBefore: firstVerdict.issues.map((issue) => issue.code), issueCodesAfter: final.verdict.issues.map((issue) => issue.code),
        scoresBefore: firstVerdict.scores, scoresAfter: final.verdict.scores,
        outputHashBefore: outputHash(input.html), outputHashAfter: outputHash(applied.html),
      } };
    } catch { return original(input, "internal_error", usage); }
  };
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, input.timeoutMs ?? 45_000); });
  try {
    const result = await Promise.race([execute(), timeout]);
    return result === "timeout" ? original(input, "timeout", usage) : result;
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
import { createHash } from "node:crypto";
