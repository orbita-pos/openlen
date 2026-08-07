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
import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";

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
}

export type SkeletonAdaptationResult =
  | {
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
    }
  | {
      ok: false;
      status: "fallback";
      reasonCode: PilotReasonCode;
      promptVersion: string | null;
      modelId: string | null;
      usage: CreativeUsage | null;
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
  sanitize?: SanitizeProbe;
  fingerprint?: (html: string, options?: StructuralFingerprintOptions) => string;
  technicalRender?: TechnicalRenderProbe;
}

interface FallbackContext {
  promptVersion: string | null;
  modelId: string | null;
  usage: CreativeUsage | null;
  durationMs: number;
}

function fallback(reasonCode: PilotReasonCode, context: FallbackContext): SkeletonAdaptationResult {
  return { ok: false, status: "fallback", reasonCode, ...context };
}

function providerFailureReason(result: Extract<GenerateCreativeDirectionResult, { ok: false }>): PilotReasonCode {
  if (result.error.kind === "timeout" || result.error.kind === "aborted") return "provider_timeout";
  if (["invalid_json", "schema", "future_version"].includes(result.error.kind)) return "invalid_provider_response";
  return "provider_error";
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
    usage: null,
    durationMs: 0,
  };

  try {
    const inventory = (deps.buildInventory ?? buildSkeletonInventory)(input.html, input.templateId);
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
      usage: creative.usage,
      durationMs: creative.durationMs,
    };

    if (!creative.ok) return fallback(providerFailureReason(creative), context);
    if (creative.response.status === "incompatible") return fallback(creative.response.reasonCode, context);

    const direction = creative.response.creativeDirection;
    const plan = creative.response.adaptationPlan;
    const compiled = (deps.compileIdentity ?? compileSkeletonIdentity)({
      html: input.html,
      inventory,
      direction,
      plan,
      brand: input.brand.accent === null ? undefined : { accent: input.brand.accent },
      explicitOverrides: input.explicitOverrides,
      explicitConstraints: input.intent.explicitConstraints,
    });
    if (!compiled.ok) return fallback(compileFailureReason(compiled), context);

    const assets = await (deps.resolveAssets ?? resolveSkeletonAssets)({
      html: compiled.html,
      inventory,
      direction,
      plan,
    }, deps.loadCuratedImages ? { loadImages: deps.loadCuratedImages } : undefined);
    if (!assets.ok) return fallback("required_asset_unavailable", context);

    const sanitized = (deps.sanitize ?? sanitizeForPublish)(assets.html);
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

    return {
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
      usage: creative.usage,
      durationMs: creative.durationMs,
    };
  } catch (error) {
    if (error instanceof SkeletonInventoryError) return fallback(error.code, context);
    return fallback("internal_error", context);
  }
}
