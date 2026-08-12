import { parse } from "node-html-parser";
import { renderHtmlToInlineImage } from "@/lib/ai/inline-image";
import {
  compileSkeletonIdentity,
  type CreativeCompileInput,
  type CreativeCompileResult,
  type ExplicitCreativeOverrides,
} from "@/lib/generation/creative-compiler";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import { applyAssetManifest, type AppliedAssetManifestResult } from "@/lib/generation/apply-asset-manifest";
import { buildAssetIntents, type BuildAssetIntentsInput } from "@/lib/generation/asset-intent";
import { AssetResolutionTraceSchema, type AssetManifest, type AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import { parseAssetGenerationBudget } from "@/lib/generation/asset-pack-provider";
import {
  resolveDomainAssetManifest,
  type AssetPipelineDependencies,
  type AssetPipelineResult,
  type ResolveDomainAssetManifestInput,
} from "@/lib/generation/asset-pipeline";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import { createGeminiAssetPackProvider } from "@/lib/generation/gemini-asset-pack-provider";
import {
  generateCreativeDirection,
  type CreativeDirectionRequest,
  type CreativeUsage,
  type GenerateCreativeDirectionResult,
} from "@/lib/generation/generate-creative-direction";
import {
  resolveSkeletonAssets,
  type ResolveSkeletonAssetsInput,
  type SkeletonAssetDependencies,
  type SkeletonAssetResult,
} from "@/lib/generation/skeleton-assets";
import { buildSkeletonInventory, SkeletonInventoryError } from "@/lib/generation/skeleton-inventory";
import {
  fingerprintStructure,
  type StructuralFingerprintOptions,
} from "@/lib/generation/structural-fingerprint";
import type { PilotReasonCode } from "@/lib/generation/visual-engine-pilot-store";
import { sanitizeForPublish } from "@/lib/html-engine";
import type { CuratedImage } from "@/lib/imagery/manifest";
import { loadCuratedImages } from "@/lib/imagery/manifest";
import { getAssetStorage } from "@/lib/projects/assets";
import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";

type CreativeTemplateMetadata = Pick<
  TemplateVisualMetadata,
  "domains" | "audiences" | "visualSignals" | "negativeTags" | "themeability"
>;

export interface AdaptTemplateSkeletonInput {
  html: string;
  templateId: string;
  intent: IntentAnalysis;
  templateMetadata: CreativeTemplateMetadata;
  brand: { accent: string | null };
  explicitOverrides?: ExplicitCreativeOverrides;
  assetContext?: { mode: AssetPipelineMode; projectId: string };
}

type AcceptedAssetMetadata =
  | { assetManifest: AssetManifest; assetTrace: AssetResolutionTrace }
  | { assetManifest?: never; assetTrace?: never };

export type SkeletonAdaptationResult =
  | ({
      ok: true;
      status: "adapted";
      html: string;
      creativeDirectionVersion: "creative-direction/1.0";
      planVersion: "skeleton-adaptation-plan/1.0";
      creativeDirection: CreativeDirection;
      promptVersion: string;
      modelId: string;
      structuralFingerprintBefore: string;
      structuralFingerprintAfter: string;
      usage: CreativeUsage;
      durationMs: number;
    } & AcceptedAssetMetadata)
  | {
      ok: false;
      status: "fallback";
      reasonCode: PilotReasonCode;
      promptVersion: string | null;
      modelId: string | null;
      usage?: CreativeUsage;
      durationMs: number;
    };

type SanitizeProbe = (html: string) => { html: string | null };
type TechnicalRenderProbe = (html: string) => Promise<boolean>;

export interface AdaptTemplateSkeletonDeps {
  buildInventory?: typeof buildSkeletonInventory;
  generateCreativeDirection?: (request: CreativeDirectionRequest) => Promise<GenerateCreativeDirectionResult>;
  compileIdentity?: (input: CreativeCompileInput) => CreativeCompileResult;
  resolveAssets?: (
    input: ResolveSkeletonAssetsInput,
    deps?: SkeletonAssetDependencies,
  ) => Promise<SkeletonAssetResult>;
  loadCuratedImages?: () => Promise<CuratedImage[]>;
  buildAssetIntents?: (input: BuildAssetIntentsInput) => ReturnType<typeof buildAssetIntents>;
  resolveDomainAssets?: (
    input: ResolveDomainAssetManifestInput,
    deps: AssetPipelineDependencies,
  ) => Promise<AssetPipelineResult>;
  applyAssetManifest?: typeof applyAssetManifest;
  assetPipelineDeps?: AssetPipelineDependencies;
  onAssetTrace?: (trace: AssetResolutionTrace) => void;
  sanitize?: SanitizeProbe;
  fingerprint?: (html: string, options?: StructuralFingerprintOptions) => string;
  technicalRender?: TechnicalRenderProbe;
}

interface FallbackContext {
  promptVersion: string | null;
  modelId: string | null;
  usage?: CreativeUsage;
  durationMs: number;
}

function fallback(reasonCode: PilotReasonCode, context: FallbackContext): SkeletonAdaptationResult {
  return { ok: false, status: "fallback", reasonCode, ...context };
}

function compileFailureReason(result: Extract<CreativeCompileResult, { ok: false }>): PilotReasonCode {
  if (result.code === "contrast_violation") return "contrast_violation";
  if (["css_policy_violation", "font_not_registered", "icon_policy_violation"].includes(result.code)) {
    return "css_policy_violation";
  }
  return "invalid_provider_response";
}

async function defaultTechnicalRender(html: string): Promise<boolean> {
  return (await renderHtmlToInlineImage(html)) !== null;
}

function hasExactCreativeDirectionMarker(html: string): boolean {
  const markers = parse(html).querySelectorAll("[data-openlen-visual-engine]");
  return markers.length === 1
    && markers[0].rawTagName?.toLowerCase() === "style"
    && markers[0].getAttribute("data-openlen-visual-engine") === "creative-direction/1.0";
}

function defaultAssetPipelineDeps(): AssetPipelineDependencies {
  const budget = parseAssetGenerationBudget(process.env) ?? {
    version: "disabled",
    maxCostMicromxn: 1,
    estimatedImageCostMicromxn: 1,
  };
  return {
    loadCuratedImages,
    catalogVersion: "openlen-images/1",
    fetchImpl: fetch,
    provider: createGeminiAssetPackProvider(),
    storage: getAssetStorage(),
    budget,
  };
}

function assetFailureReason(result: Extract<AssetPipelineResult, { ok: false }>): PilotReasonCode {
  if (result.code === "required_asset_unavailable" || result.code === "asset_slot_unavailable") return result.code;
  if (result.code === "provider_error") return "provider_error";
  if (result.code === "invalid_asset") return "invalid_provider_response";
  return "internal_error";
}

function emitAssetTrace(trace: unknown, sink: AdaptTemplateSkeletonDeps["onAssetTrace"]): void {
  const parsed = AssetResolutionTraceSchema.safeParse(trace);
  if (!parsed.success) return;
  try { sink?.(parsed.data); } catch { /* Telemetry never changes candidate delivery. */ }
}

/**
 * Adapts a safe template skeleton as one atomic candidate. Every intermediate
 * HTML string remains local to this function and no failure exposes it.
 */
export async function adaptTemplateSkeleton(
  input: AdaptTemplateSkeletonInput,
  deps: AdaptTemplateSkeletonDeps = {},
): Promise<SkeletonAdaptationResult> {
  let context: FallbackContext = {
    promptVersion: null,
    modelId: null,
    durationMs: 0,
  };

  try {
    const sanitize = deps.sanitize ?? sanitizeForPublish;
    const baseline = sanitize(input.html);
    if (baseline.html === null) return fallback("sanitization_failed", context);
    const sourceHtml = baseline.html;
    const inventory = (deps.buildInventory ?? buildSkeletonInventory)(sourceHtml, input.templateId);
    const before = inventory.structuralFingerprint;
    const creative = await (deps.generateCreativeDirection ?? generateCreativeDirection)({
      intent: input.intent,
      template: input.templateMetadata,
      inventory,
      brand: input.brand,
    });
    context = {
      promptVersion: creative.promptVersion,
      modelId: creative.modelId,
      ...(creative.usage ? { usage: creative.usage } : {}),
      durationMs: creative.durationMs,
    };

    const resolvedCreative = !creative.ok || creative.response.status === "incompatible"
      ? buildDeterministicCreativeDirection(input.intent)
      : {
          direction: creative.response.creativeDirection,
          plan: creative.response.adaptationPlan,
        };
    const creativeUsage = creative.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cachedTokens: 0,
    };

    let direction = resolvedCreative.direction;
    let plan = resolvedCreative.plan;
    const compile = deps.compileIdentity ?? compileSkeletonIdentity;
    let compiled = compile({
      html: sourceHtml,
      inventory,
      direction,
      plan,
      brand: input.brand.accent === null ? undefined : { accent: input.brand.accent },
      explicitOverrides: input.explicitOverrides,
      explicitConstraints: input.intent.explicitConstraints,
    });
    if (!compiled.ok && creative.ok && creative.response.status === "ready") {
      const deterministic = buildDeterministicCreativeDirection(input.intent);
      direction = deterministic.direction;
      plan = deterministic.plan;
      compiled = compile({
        html: sourceHtml,
        inventory,
        direction,
        plan,
        brand: input.brand.accent === null ? undefined : { accent: input.brand.accent },
        explicitOverrides: input.explicitOverrides,
        explicitConstraints: input.intent.explicitConstraints,
      });
    }
    if (!compiled.ok) return fallback(compileFailureReason(compiled), context);

    const mode = input.assetContext?.mode ?? "off";
    let assets: SkeletonAssetResult | AppliedAssetManifestResult;
    let acceptedAssetMetadata: { assetManifest: AssetManifest; assetTrace: AssetResolutionTrace } | undefined;
    if (mode === "off" || mode === "shadow") {
      assets = await (deps.resolveAssets ?? resolveSkeletonAssets)({
        html: compiled.html,
        inventory,
        direction,
        plan,
      }, deps.loadCuratedImages ? { loadImages: deps.loadCuratedImages } : undefined);
      if (!assets.ok) return fallback(assets.code, context);

      if (mode === "shadow" && input.assetContext) {
        try {
          const intents = (deps.buildAssetIntents ?? buildAssetIntents)({
            intent: input.intent,
            direction,
            inventory,
            plan: { assets: plan.assets },
          });
          if (intents.length > 0) {
            const shadow = await (deps.resolveDomainAssets ?? resolveDomainAssetManifest)({
              intents,
              direction,
              projectId: input.assetContext.projectId,
              mode: "curated",
            }, deps.assetPipelineDeps ?? defaultAssetPipelineDeps());
            emitAssetTrace(shadow.trace, deps.onAssetTrace);
          }
        } catch {
          // Shadow never changes delivery and exposes no candidate metadata.
        }
      }
    } else {
      const intents = (deps.buildAssetIntents ?? buildAssetIntents)({
        intent: input.intent,
        direction,
        inventory,
        plan: { assets: plan.assets },
      });
      if (intents.length === 0) {
        assets = { ok: true, html: compiled.html, applied: 0, assigned: [] };
      } else {
        const resolved = await (deps.resolveDomainAssets ?? resolveDomainAssetManifest)({
          intents,
          direction,
          projectId: input.assetContext!.projectId,
          mode,
        }, deps.assetPipelineDeps ?? defaultAssetPipelineDeps());
        emitAssetTrace(resolved.trace, deps.onAssetTrace);
        if (!resolved.ok) return fallback(assetFailureReason(resolved), context);
        const applied = (deps.applyAssetManifest ?? applyAssetManifest)({
          html: compiled.html,
          manifest: resolved.manifest,
          inputFingerprint: before,
        });
        if (!applied.ok) return fallback(applied.code, context);
        assets = applied;
        acceptedAssetMetadata = { assetManifest: resolved.manifest, assetTrace: resolved.trace };
      }
    }

    const sanitized = sanitize(assets.html);
    if (sanitized.html === null) return fallback("sanitization_failed", context);

    const allowedAssetSlots = inventory.assetSlots
      .filter((slot) => slot.replaceable)
      .map((slot) => slot.slotIndex);
    const after = (deps.fingerprint ?? fingerprintStructure)(sanitized.html, { allowedAssetSlots });
    if (after !== before || !hasExactCreativeDirectionMarker(sanitized.html)) {
      return fallback("structural_invariant_failed", context);
    }

    if (!(await (deps.technicalRender ?? defaultTechnicalRender)(sanitized.html))) {
      return fallback("technical_render_failed", context);
    }

    const result = {
      ok: true,
      status: "adapted",
      html: sanitized.html,
      creativeDirectionVersion: direction.schemaVersion,
      planVersion: plan.schemaVersion,
      creativeDirection: direction,
      promptVersion: creative.promptVersion,
      modelId: creative.modelId,
      structuralFingerprintBefore: before,
      structuralFingerprintAfter: after,
      usage: creativeUsage,
      durationMs: creative.durationMs,
    } as const;
    return acceptedAssetMetadata
      ? { ...result, assetManifest: acceptedAssetMetadata.assetManifest, assetTrace: acceptedAssetMetadata.assetTrace }
      : result;
  } catch (error) {
    if (error instanceof SkeletonInventoryError) return fallback(error.code, context);
    return fallback("internal_error", context);
  }
}
