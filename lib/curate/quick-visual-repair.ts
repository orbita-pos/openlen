import { captureException as reportException } from "@inariwatch/capture";
import { critiqueVisualQuality } from "@/lib/ai/visual-quality-critic";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { applyVisualRepairPlan } from "@/lib/generation/apply-visual-repair";
import { runClosedLoopVisualRepair } from "@/lib/generation/closed-loop-repair";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import { generateVisualRepairPlan } from "@/lib/generation/generate-visual-repair";
import type { VisualRepairMode } from "@/lib/generation/visual-repair-mode";
import type { VisualEngineProjectMetadata, VisualRepairProjectMetadata } from "@/lib/projects/types";

export interface QuickVisualRepairInput {
  html: string;
  visualEngine: VisualEngineProjectMetadata;
  intent: IntentAnalysis;
  brandAccent?: string | null;
  explicitConstraints?: readonly string[];
}

type RunRepair = (
  input: Parameters<typeof runClosedLoopVisualRepair>[0],
) => ReturnType<typeof runClosedLoopVisualRepair>;
export interface QuickVisualRepairDeps {
  mode?: VisualRepairMode;
  runRepair?: RunRepair;
  captureException?: (error: Error, context: { route: string; stage: string }) => void;
}

function eligible(input: QuickVisualRepairInput): boolean {
  return (input.visualEngine.route === "template_skeleton" || input.visualEngine.route === "section_composition")
    && Boolean(input.visualEngine.creativeDirection);
}

async function defaultRepair(input: Parameters<RunRepair>[0]) {
  return runClosedLoopVisualRepair(input, {
    render: (html) => renderVisualQualityViewports(html),
    critic: (request) => critiqueVisualQuality({ ...request, model: process.env.OPENLEN_VISUAL_ENGINE_CRITIC_MODEL ?? "gemini-2.5-flash" }),
    generatePlan: (request) => generateVisualRepairPlan(request),
    applyPlan: (request) => applyVisualRepairPlan(request),
  });
}

function repairMetadata(trace: Extract<Awaited<ReturnType<RunRepair>>, { accepted: true }>["trace"]): VisualRepairProjectMetadata {
  return {
    schemaVersion: "visual-repair-metadata/1.0", accepted: true,
    promptVersion: trace.promptVersion, criticVersion: trace.criticVersion,
    compilerVersion: "creative-direction/1.0",
    issueCodesBefore: [...trace.issueCodesBefore], issueCodesAfter: [...trace.issueCodesAfter],
    scoresBefore: { ...trace.scoresBefore }, scoresAfter: { ...trace.scoresAfter },
    outputHashBefore: trace.outputHashBefore, outputHashAfter: trace.outputHashAfter,
  };
}

function repairInput(input: QuickVisualRepairInput): Parameters<RunRepair>[0] {
  return {
    html: input.html, metadata: input.visualEngine,
    sourceId: input.visualEngine.templateId ?? "section-composition",
    intent: input.intent, direction: input.visualEngine.creativeDirection,
    route: input.visualEngine.route, brandAccent: input.brandAccent,
    explicitConstraints: input.explicitConstraints,
  };
}

export async function runQuickVisualRepair(input: QuickVisualRepairInput, deps: QuickVisualRepairDeps = {}) {
  if ((deps.mode ?? "off") !== "on" || !eligible(input)) return { html: input.html, visualEngine: input.visualEngine };
  try {
    const result = await (deps.runRepair ?? defaultRepair)(repairInput(input));
    if (!result.accepted) return { html: input.html, visualEngine: input.visualEngine };
    return { html: result.html, visualEngine: { ...input.visualEngine, repair: repairMetadata(result.trace) } };
  } catch {
    (deps.captureException ?? reportException)(new Error("Visual repair on failed"), { route: "curate", stage: "visual-repair-on" });
    return { html: input.html, visualEngine: input.visualEngine };
  }
}

export async function launchShadowVisualRepair(input: QuickVisualRepairInput, deps: QuickVisualRepairDeps = {}): Promise<void> {
  if (!eligible(input)) return;
  try { await (deps.runRepair ?? defaultRepair)(repairInput(input)); }
  catch { (deps.captureException ?? reportException)(new Error("Visual repair shadow failed"), { route: "curate", stage: "visual-repair-shadow" }); }
}
