import { parse } from "node-html-parser";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { sanitizeForPublish } from "@/lib/html-engine";
import { compileSkeletonIdentity, type CreativeCompileInput, type CreativeCompileResult } from "./creative-compiler";
import type { CreativeDirection, SkeletonAdaptationPlan, SkeletonInventory } from "./creative-contracts";
import { resolveSkeletonAssets, type ResolveSkeletonAssetsInput, type SkeletonAssetResult } from "./skeleton-assets";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { fingerprintStructure, type StructuralFingerprintOptions } from "./structural-fingerprint";
import type { VisualRepairIssueCode } from "./visual-repair-contracts";
import type { IntentAnalysis } from "./contracts";
import type { AssetPipelineMode } from "./asset-pipeline-mode";
import { AssetResolutionTraceSchema, type AssetManifest, type AssetResolutionTrace } from "./asset-contracts";
import { buildAssetIntents, type BuildAssetIntentsInput } from "./asset-intent";
import { resolveDomainAssetManifest, type AssetPipelineDependencies, type AssetPipelineResult, type ResolveDomainAssetManifestInput } from "./asset-pipeline";
import { applyAssetManifest, type AppliedAssetManifestResult } from "./apply-asset-manifest";
import { parseAssetGenerationBudget } from "./asset-pack-provider";
import { createGeminiAssetPackProvider } from "./gemini-asset-pack-provider";
import { loadCuratedImages } from "@/lib/imagery/manifest";
import { getAssetStorage } from "@/lib/projects/assets";

export const MOBILE_OVERFLOW_REPAIR_CSS = "@media(max-width:700px){html,body{max-width:100%!important;overflow-x:hidden!important}body>:first-child{width:100%!important;max-width:100%!important;margin-left:auto!important;margin-right:auto!important}[data-openlen-role=\"hero\"],[data-openlen-role=\"features\"]{grid-template-columns:minmax(0,1fr)!important;max-width:100%!important}[data-openlen-role]{min-width:0!important;max-width:100%!important}[data-openlen-role] img,[data-openlen-role] video,[data-openlen-role] canvas,[data-openlen-role] svg{max-width:100%!important;height:auto!important}}";

export interface ApplyVisualRepairInput { html: string; sourceId: string; intent?: IntentAnalysis; direction: CreativeDirection; plan: SkeletonAdaptationPlan; assetContext?: { mode: AssetPipelineMode; projectId: string }; assetTraceSink?: (trace: AssetResolutionTrace) => void; brandAccent?: string | null; explicitConstraints?: readonly string[]; issueCodes?: readonly VisualRepairIssueCode[] }
type AcceptedAssetMetadata =
  | { assetManifest: AssetManifest; assetTrace: AssetResolutionTrace }
  | { assetManifest?: never; assetTrace?: never };
export type ApplyVisualRepairResult = ({ ok: true; html: string; structuralFingerprintBefore: string; structuralFingerprintAfter: string } & AcceptedAssetMetadata)
  | { ok: false; code: "inventory_failed" | "compile_failed" | "asset_failed" | "sanitization_failed" | "structural_invariant_failed" | "technical_render_failed" };
export interface ApplyVisualRepairDeps {
  buildInventory?: (html: string, sourceId: string) => SkeletonInventory;
  compileIdentity?: (input: CreativeCompileInput) => CreativeCompileResult;
  resolveAssets?: (input: ResolveSkeletonAssetsInput) => Promise<SkeletonAssetResult>;
  buildAssetIntents?: (input: BuildAssetIntentsInput) => ReturnType<typeof buildAssetIntents>;
  resolveDomainAssets?: (input: ResolveDomainAssetManifestInput, deps: AssetPipelineDependencies) => Promise<AssetPipelineResult>;
  applyAssetManifest?: typeof applyAssetManifest;
  assetPipelineDeps?: AssetPipelineDependencies;
  sanitize?: (html: string) => { html: string | null };
  fingerprint?: (html: string, options?: StructuralFingerprintOptions) => string;
  technicalRender?: (html: string) => Promise<boolean>;
}
function defaultAssetPipelineDeps(): AssetPipelineDependencies {
  return {
    loadCuratedImages,
    catalogVersion: "openlen-images/1",
    fetchImpl: fetch,
    provider: createGeminiAssetPackProvider(),
    storage: getAssetStorage(),
    budget: parseAssetGenerationBudget(process.env) ?? { version: "disabled", maxCostMicromxn: 1, estimatedImageCostMicromxn: 1 },
  };
}
function roles(html: string): string[] { return parse(html).querySelectorAll("[data-openlen-role]").map((node) => node.getAttribute("data-openlen-role") ?? ""); }
function oneMarker(html: string): boolean { const nodes = parse(html).querySelectorAll('style[data-openlen-visual-engine="creative-direction/1.0"]'); return nodes.length === 1; }
function emitAssetTrace(trace: unknown, sink: ApplyVisualRepairInput["assetTraceSink"]): void {
  const parsed = AssetResolutionTraceSchema.safeParse(trace);
  if (!parsed.success) return;
  try { sink?.(parsed.data); } catch { /* Telemetry never changes candidate delivery. */ }
}
function applyBoundedResponsiveRepair(html: string, issueCodes: readonly VisualRepairIssueCode[] | undefined): string | null {
  if (!Array.isArray(issueCodes) || !issueCodes.includes("mobile_overflow")) return html;
  const marker = '<style data-openlen-visual-engine="creative-direction/1.0">';
  const start = html.indexOf(marker);
  if (start < 0 || html.indexOf(marker, start + marker.length) >= 0) return null;
  const close = html.indexOf("</style>", start + marker.length);
  if (close < 0) return null;
  return html.slice(0, close) + MOBILE_OVERFLOW_REPAIR_CSS + html.slice(close);
}

export async function applyVisualRepairPlan(input: ApplyVisualRepairInput, deps: ApplyVisualRepairDeps = {}): Promise<ApplyVisualRepairResult> {
  try {
    const inventory = (deps.buildInventory ?? buildSkeletonInventory)(input.html, input.sourceId);
    const before = inventory.structuralFingerprint;
    const compiled = (deps.compileIdentity ?? compileSkeletonIdentity)({ html: input.html, inventory, direction: input.direction, plan: input.plan, brand: input.brandAccent ? { accent: input.brandAccent } : undefined, explicitConstraints: input.explicitConstraints });
    if (!compiled.ok) return { ok: false, code: "compile_failed" };
    const responsiveHtml = applyBoundedResponsiveRepair(compiled.html, input.issueCodes);
    if (!responsiveHtml) return { ok: false, code: "compile_failed" };
    const mode = input.assetContext?.mode ?? "off";
    let assets: SkeletonAssetResult | AppliedAssetManifestResult;
    let acceptedAssetMetadata: { assetManifest: AssetManifest; assetTrace: AssetResolutionTrace } | undefined;
    if (mode === "off" || mode === "shadow") {
      assets = await (deps.resolveAssets ?? resolveSkeletonAssets)({ html: responsiveHtml, inventory, direction: input.direction, plan: input.plan });
      if (!assets.ok) return { ok: false, code: "asset_failed" };
      if (mode === "shadow" && input.intent && input.assetContext) {
        try {
          const intents = (deps.buildAssetIntents ?? buildAssetIntents)({ intent: input.intent, direction: input.direction, inventory, plan: input.plan });
          if (intents.length > 0) {
            const shadow = await (deps.resolveDomainAssets ?? resolveDomainAssetManifest)({ intents, direction: input.direction, projectId: input.assetContext.projectId, mode: "curated" }, deps.assetPipelineDeps ?? defaultAssetPipelineDeps());
            emitAssetTrace(shadow.trace, input.assetTraceSink);
          }
        } catch { /* shadow never changes the repair candidate */ }
      }
    } else {
      if (!input.intent) return { ok: false, code: "asset_failed" };
      const intents = (deps.buildAssetIntents ?? buildAssetIntents)({ intent: input.intent, direction: input.direction, inventory, plan: input.plan });
      if (intents.length === 0) {
        assets = { ok: true, html: responsiveHtml, applied: 0, assigned: [] };
      } else {
        const resolved = await (deps.resolveDomainAssets ?? resolveDomainAssetManifest)({ intents, direction: input.direction, projectId: input.assetContext!.projectId, mode }, deps.assetPipelineDeps ?? defaultAssetPipelineDeps());
        emitAssetTrace(resolved.trace, input.assetTraceSink);
        if (!resolved.ok) return { ok: false, code: "asset_failed" };
        const applied = (deps.applyAssetManifest ?? applyAssetManifest)({ html: responsiveHtml, manifest: resolved.manifest, inputFingerprint: before });
        if (!applied.ok) return { ok: false, code: "asset_failed" };
        assets = applied;
        acceptedAssetMetadata = { assetManifest: resolved.manifest, assetTrace: resolved.trace };
      }
    }
    const sanitized = (deps.sanitize ?? sanitizeForPublish)(assets.html);
    if (!sanitized.html) return { ok: false, code: "sanitization_failed" };
    const allowedAssetSlots = inventory.assetSlots.filter((slot) => slot.replaceable).map((slot) => slot.slotIndex);
    const after = (deps.fingerprint ?? fingerprintStructure)(sanitized.html, { allowedAssetSlots });
    if (after !== before || JSON.stringify(roles(input.html)) !== JSON.stringify(roles(sanitized.html)) || !oneMarker(sanitized.html)) return { ok: false, code: "structural_invariant_failed" };
    const render = deps.technicalRender ?? (async (html: string) => (await renderVisualQualityViewports(html)) !== null);
    if (!(await render(sanitized.html))) return { ok: false, code: "technical_render_failed" };
    const result = { ok: true as const, html: sanitized.html, structuralFingerprintBefore: before, structuralFingerprintAfter: after };
    return acceptedAssetMetadata
      ? { ...result, assetManifest: acceptedAssetMetadata.assetManifest, assetTrace: acceptedAssetMetadata.assetTrace }
      : result;
  } catch { return { ok: false, code: "inventory_failed" }; }
}
