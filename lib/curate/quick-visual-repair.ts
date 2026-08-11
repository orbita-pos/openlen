import { captureException as reportException } from "@inariwatch/capture";
import { critiqueVisualQuality } from "@/lib/ai/visual-quality-critic";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { applyVisualRepairPlan } from "@/lib/generation/apply-visual-repair";
import { runClosedLoopVisualRepair } from "@/lib/generation/closed-loop-repair";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import { generateVisualRepairPlan } from "@/lib/generation/generate-visual-repair";
import { AssetManifestSchema, AssetResolutionTraceSchema, validateAssetManifestHash } from "@/lib/generation/asset-contracts";
import type { AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import type { VisualRepairMode } from "@/lib/generation/visual-repair-mode";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { VisualEngineAssetMetadata, VisualEngineProjectMetadata, VisualRepairProjectMetadata } from "@/lib/projects/types";
import { sha256 } from "@/lib/generation/visual-engine-2a-eval";
import { sealAiCompositionOutput } from "./ai-composition-delivery";

export interface QuickVisualRepairInput {
  projectId?: string;
  assetMode?: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
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

type CompositionMetadata = Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;

export type QuickVisualQualityGateResult =
  | {
      ok: true;
      outcome: "healthy_keep" | "repaired";
      html: string;
      visualEngine: CompositionMetadata;
    }
  | {
      ok: false;
      reasonCode: "visual_quality_failed";
      detailCode: string;
    };

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
    ...(input.projectId && input.assetMode ? { assetContext: { mode: input.assetMode, projectId: input.projectId } } : {}),
    ...(input.assetTraceSink ? { assetTraceSink: input.assetTraceSink } : {}),
  };
}

function replacementAssetMetadata(metadata: object): VisualEngineAssetMetadata {
  const candidate = metadata as Pick<VisualEngineProjectMetadata, "assetManifest" | "assetTrace">;
  if (!candidate.assetManifest || !candidate.assetTrace) return {};
  const manifest = AssetManifestSchema.safeParse(candidate.assetManifest);
  const trace = AssetResolutionTraceSchema.safeParse(candidate.assetTrace);
  if (!manifest.success || !trace.success || !validateAssetManifestHash(manifest.data)) return {};
  if (trace.data.manifestId !== manifest.data.manifestId || trace.data.resultCode !== "resolved") return {};
  return { assetManifest: manifest.data, assetTrace: trace.data };
}

export async function runQuickVisualRepair(input: QuickVisualRepairInput, deps: QuickVisualRepairDeps = {}) {
  if ((deps.mode ?? "off") !== "on" || !eligible(input)) return { html: input.html, visualEngine: input.visualEngine };
  try {
    const result = await (deps.runRepair ?? defaultRepair)(repairInput(input));
    if (!result.accepted) return { html: input.html, visualEngine: input.visualEngine };
    const replacement = replacementAssetMetadata(result.metadata);
    const repair = repairMetadata(result.trace);
    const visualEngine: VisualEngineProjectMetadata = replacement.assetManifest && replacement.assetTrace
      ? { ...input.visualEngine, assetManifest: replacement.assetManifest, assetTrace: replacement.assetTrace, repair }
      : { ...input.visualEngine, repair };
    return { html: result.html, visualEngine };
  } catch {
    (deps.captureException ?? reportException)(new Error("Visual repair on failed"), { route: "curate", stage: "visual-repair-on" });
    return { html: input.html, visualEngine: input.visualEngine };
  }
}

function qualityFailure(detailCode: string): QuickVisualQualityGateResult {
  return { ok: false, reasonCode: "visual_quality_failed", detailCode };
}

export async function runQuickVisualQualityGate(
  input: QuickVisualRepairInput & { visualEngine: CompositionMetadata },
  deps: QuickVisualRepairDeps = {},
): Promise<QuickVisualQualityGateResult> {
  try {
    const inputHash = sha256(input.html);
    if (input.visualEngine.compositionManifest.outputHash !== inputHash) {
      return qualityFailure("internal_error");
    }

    const result = await (deps.runRepair ?? defaultRepair)(repairInput(input));
    if (!result.accepted) {
      return result.trace.resultCode === "healthy_keep"
        ? {
            ok: true,
            outcome: "healthy_keep",
            html: input.html,
            visualEngine: sealAiCompositionOutput(input.visualEngine, input.html),
          }
        : qualityFailure(result.trace.resultCode);
    }

    const outputHash = sha256(result.html);
    if (result.trace.resultCode !== "accepted"
      || result.trace.outputHashBefore !== inputHash
      || result.trace.outputHashAfter !== outputHash) {
      return qualityFailure("internal_error");
    }

    const replacement = replacementAssetMetadata(result.metadata);
    const repair = repairMetadata(result.trace);
    const repaired = replacement.assetManifest && replacement.assetTrace
      ? { ...input.visualEngine, assetManifest: replacement.assetManifest, assetTrace: replacement.assetTrace, repair }
      : { ...input.visualEngine, repair };
    return {
      ok: true,
      outcome: "repaired",
      html: result.html,
      visualEngine: sealAiCompositionOutput(repaired, result.html),
    };
  } catch {
    (deps.captureException ?? reportException)(new Error("Visual quality gate failed"), { route: "curate", stage: "visual-quality-gate" });
    return qualityFailure("internal_error");
  }
}

export async function launchShadowVisualRepair(input: QuickVisualRepairInput, deps: QuickVisualRepairDeps = {}): Promise<void> {
  if (!eligible(input)) return;
  try { await (deps.runRepair ?? defaultRepair)(repairInput(input)); }
  catch { (deps.captureException ?? reportException)(new Error("Visual repair shadow failed"), { route: "curate", stage: "visual-repair-shadow" }); }
}
