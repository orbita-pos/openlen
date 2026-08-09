import { parse } from "node-html-parser";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { sanitizeForPublish } from "@/lib/html-engine";
import { compileSkeletonIdentity, type CreativeCompileInput, type CreativeCompileResult } from "./creative-compiler";
import type { CreativeDirection, SkeletonAdaptationPlan, SkeletonInventory } from "./creative-contracts";
import { resolveSkeletonAssets, type ResolveSkeletonAssetsInput, type SkeletonAssetResult } from "./skeleton-assets";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { fingerprintStructure, type StructuralFingerprintOptions } from "./structural-fingerprint";

export interface ApplyVisualRepairInput { html: string; sourceId: string; direction: CreativeDirection; plan: SkeletonAdaptationPlan; brandAccent?: string | null; explicitConstraints?: readonly string[] }
export type ApplyVisualRepairResult = { ok: true; html: string; structuralFingerprintBefore: string; structuralFingerprintAfter: string }
  | { ok: false; code: "inventory_failed" | "compile_failed" | "asset_failed" | "sanitization_failed" | "structural_invariant_failed" | "technical_render_failed" };
export interface ApplyVisualRepairDeps {
  buildInventory?: (html: string, sourceId: string) => SkeletonInventory;
  compileIdentity?: (input: CreativeCompileInput) => CreativeCompileResult;
  resolveAssets?: (input: ResolveSkeletonAssetsInput) => Promise<SkeletonAssetResult>;
  sanitize?: (html: string) => { html: string | null };
  fingerprint?: (html: string, options?: StructuralFingerprintOptions) => string;
  technicalRender?: (html: string) => Promise<boolean>;
}
function roles(html: string): string[] { return parse(html).querySelectorAll("[data-openlen-role]").map((node) => node.getAttribute("data-openlen-role") ?? ""); }
function oneMarker(html: string): boolean { const nodes = parse(html).querySelectorAll('style[data-openlen-visual-engine="creative-direction/1.0"]'); return nodes.length === 1; }

export async function applyVisualRepairPlan(input: ApplyVisualRepairInput, deps: ApplyVisualRepairDeps = {}): Promise<ApplyVisualRepairResult> {
  try {
    const inventory = (deps.buildInventory ?? buildSkeletonInventory)(input.html, input.sourceId);
    const before = inventory.structuralFingerprint;
    const compiled = (deps.compileIdentity ?? compileSkeletonIdentity)({ html: input.html, inventory, direction: input.direction, plan: input.plan, brand: input.brandAccent ? { accent: input.brandAccent } : undefined, explicitConstraints: input.explicitConstraints });
    if (!compiled.ok) return { ok: false, code: "compile_failed" };
    const assets = await (deps.resolveAssets ?? resolveSkeletonAssets)({ html: compiled.html, inventory, direction: input.direction, plan: input.plan });
    if (!assets.ok) return { ok: false, code: "asset_failed" };
    const sanitized = (deps.sanitize ?? sanitizeForPublish)(assets.html);
    if (!sanitized.html) return { ok: false, code: "sanitization_failed" };
    const allowedAssetSlots = inventory.assetSlots.filter((slot) => slot.replaceable).map((slot) => slot.slotIndex);
    const after = (deps.fingerprint ?? fingerprintStructure)(sanitized.html, { allowedAssetSlots });
    if (after !== before || JSON.stringify(roles(input.html)) !== JSON.stringify(roles(sanitized.html)) || !oneMarker(sanitized.html)) return { ok: false, code: "structural_invariant_failed" };
    const render = deps.technicalRender ?? (async (html: string) => (await renderVisualQualityViewports(html)) !== null);
    if (!(await render(sanitized.html))) return { ok: false, code: "technical_render_failed" };
    return { ok: true, html: sanitized.html, structuralFingerprintBefore: before, structuralFingerprintAfter: after };
  } catch { return { ok: false, code: "inventory_failed" }; }
}
