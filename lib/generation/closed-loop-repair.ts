import type { VisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import type { VisualQualityCriticResult, VisualQualityUsage } from "@/lib/ai/visual-quality-critic";
import type { CreativeDirection, SkeletonAdaptationPlan, SkeletonInventory } from "./creative-contracts";
import { buildSkeletonInventory } from "./skeleton-inventory";
import type { IntentAnalysis } from "./contracts";
import type { ApplyVisualRepairResult } from "./apply-visual-repair";
import type { GenerateVisualRepairPlanResult } from "./generate-visual-repair";
import type { VisualQualityScores, VisualQualityVerdict, VisualRepairIssueCode } from "./visual-repair-contracts";

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
export interface ClosedLoopVisualRepairInput { html: string; metadata: object; sourceId: string; intent: IntentAnalysis; direction: CreativeDirection; route: "template_skeleton" | "section_composition"; brandAccent?: string | null; explicitConstraints?: readonly string[]; timeoutMs?: number }
export interface ClosedLoopVisualRepairDeps {
  buildInventory?: (html: string, sourceId: string) => SkeletonInventory;
  render(html: string, options?: { signal: AbortSignal }): Promise<VisualQualityViewports | null>;
  critic(input: { intent: IntentAnalysis; direction: CreativeDirection; orderedRoles: string[]; route: ClosedLoopVisualRepairInput["route"]; images: VisualQualityViewports }, options?: { signal: AbortSignal }): Promise<VisualQualityCriticResult>;
  generatePlan(input: { direction: CreativeDirection; inventory: SkeletonInventory; verdict: VisualQualityVerdict }, options?: { signal: AbortSignal }): Promise<GenerateVisualRepairPlanResult>;
  applyPlan(input: { html: string; sourceId: string; direction: CreativeDirection; plan: SkeletonAdaptationPlan; brandAccent?: string | null; explicitConstraints?: readonly string[]; issueCodes?: readonly VisualRepairIssueCode[] }, options?: { signal: AbortSignal }): Promise<ApplyVisualRepairResult>;
}
function orderedRoles(html: string): string[] { return [...html.matchAll(/data-openlen-role=["']([^"']+)["']/gi)].map((match) => match[1]!); }
function outputHash(html: string): string { return `sha256:${createHash("sha256").update(html).digest("hex")}`; }
function original(input: ClosedLoopVisualRepairInput, code: string, usage: VisualQualityUsage[] = []) { return { html: input.html, metadata: input.metadata, accepted: false as const, trace: { resultCode: code, usage: usage.map((item) => ({ ...item })) } }; }

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
      if (!shouldAttemptVisualRepair(first.verdict)) return original(input, first.verdict.decision === "keep" ? "healthy_keep" : "nonrepairable", usage);
      const inventory = (deps.buildInventory ?? buildSkeletonInventory)(input.html, input.sourceId);
      const generated = await deps.generatePlan({ direction: input.direction, inventory, verdict: first.verdict }, boundary);
      if (generated.usage) usage.push(generated.usage);
      if (!generated.ok) return original(input, "repair_provider_failed", usage);
      const applied = await deps.applyPlan({ html: input.html, sourceId: input.sourceId, direction: input.direction, plan: generated.plan, brandAccent: input.brandAccent, explicitConstraints: input.explicitConstraints, issueCodes: first.verdict.issues.map((issue) => issue.code) }, boundary);
      if (!applied.ok) return original(input, applied.code, usage);
      const finalImages = await deps.render(applied.html, boundary); if (!finalImages) return original(input, "final_render_failed", usage);
      const final = await deps.critic({ intent: input.intent, direction: input.direction, orderedRoles: orderedRoles(applied.html), route: input.route, images: finalImages }, boundary);
      if (final.usage) usage.push(final.usage);
      if (!final.ok || !repairImprovesQuality(first.verdict, final.verdict)) return original(input, !final.ok ? "final_critic_failed" : "not_improved", usage);
      return { html: applied.html, metadata: { ...input.metadata }, accepted: true as const, trace: {
        resultCode: "accepted", usage: usage.map((item) => ({ ...item })),
        promptVersion: generated.promptVersion, criticVersion: "visual-quality-verdict/2.1" as const,
        issueCodesBefore: first.verdict.issues.map((issue) => issue.code), issueCodesAfter: final.verdict.issues.map((issue) => issue.code),
        scoresBefore: first.verdict.scores, scoresAfter: final.verdict.scores,
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
