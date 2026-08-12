import { parse } from "node-html-parser";

import {
  AssetManifestSchema,
  AssetResolutionTraceSchema,
  validateAssetManifestHash,
} from "@/lib/generation/asset-contracts";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import {
  hasOriginalSectionProvenance,
  SectionCompositionManifestSchema,
} from "@/lib/generation/section-composition-contracts";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/content-hash";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

type CompositionMetadata = Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;

export type AiCompositionDeliveryReason =
  | "invalid_composition_metadata"
  | "invalid_composition_manifest"
  | "section_role_coverage_failed"
  | "section_originality_failed"
  | "creative_marker_invalid"
  | "output_hash_mismatch"
  | "asset_metadata_invalid";

export function sealAiCompositionOutput(
  visualEngine: CompositionMetadata,
  html: string,
): CompositionMetadata {
  return {
    ...visualEngine,
    compositionManifest: SectionCompositionManifestSchema.parse({
      ...visualEngine.compositionManifest,
      outputHash: sha256(html),
      resultCode: "composed",
    }),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validMetadataShape(value: Record<string, unknown>): boolean {
  return value.schemaVersion === "visual-engine-project/1.0"
    && value.route === "section_composition"
    && value.templateId === null
    && typeof value.promptVersion === "string"
    && value.promptVersion.length > 0
    && typeof value.policyVersion === "string"
    && value.policyVersion.length > 0
    && value.contractVersion === "creative-direction/1.0";
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assetsAreValid(value: Record<string, unknown>): boolean {
  const hasManifest = hasOwn(value, "assetManifest") && value.assetManifest !== undefined;
  const hasTrace = hasOwn(value, "assetTrace") && value.assetTrace !== undefined;
  if (!hasManifest && !hasTrace) return true;
  if (!hasManifest || !hasTrace) return false;

  const manifest = AssetManifestSchema.safeParse(value.assetManifest);
  const trace = AssetResolutionTraceSchema.safeParse(value.assetTrace);
  return manifest.success
    && trace.success
    && validateAssetManifestHash(manifest.data)
    && trace.data.manifestId === manifest.data.manifestId
    && trace.data.resultCode === "resolved";
}

function rolesAndSectionsAreExact(
  html: string,
  orderedRoles: readonly string[],
  selectedSectionIds: readonly string[],
  selectedContentHashes: readonly string[],
): boolean {
  if (orderedRoles.length < 3 || selectedSectionIds.length < 3) return false;
  if (new Set(selectedSectionIds).size !== selectedSectionIds.length) return false;
  if (new Set(selectedContentHashes).size < 3) return false;

  const root = parse(html);
  const body = root.querySelector("body");
  if (!body) return false;
  const nodes = root.querySelectorAll("[data-openlen-role]");
  if (nodes.length !== orderedRoles.length) return false;

  return nodes.every((node, index) => node.parentNode === body
    && node.getAttribute("data-openlen-role") === orderedRoles[index]
    && node.getAttribute("data-sec") === selectedSectionIds[index]);
}

function hasOneCreativeMarker(html: string): boolean {
  return parse(html).querySelectorAll('style[data-openlen-visual-engine="creative-direction/1.0"]').length === 1;
}

export function validateAiCompositionDelivery(input: {
  html: string;
  visualEngine: unknown;
  leaksAfter: number;
}):
  | { ok: true; visualEngine: CompositionMetadata }
  | { ok: false; reasonCode: AiCompositionDeliveryReason } {
  const metadata = record(input.visualEngine);
  if (!metadata || !validMetadataShape(metadata)) {
    return { ok: false, reasonCode: "invalid_composition_metadata" };
  }

  const direction = CreativeDirectionSchema.safeParse(metadata.creativeDirection);
  if (!direction.success) {
    return { ok: false, reasonCode: "invalid_composition_metadata" };
  }
  const manifest = SectionCompositionManifestSchema.safeParse(metadata.compositionManifest);
  if (!manifest.success
    || manifest.data.resultCode !== "composed"
    || manifest.data.creativeDirectionHash !== canonicalJsonSha256(direction.data)) {
    return { ok: false, reasonCode: "invalid_composition_manifest" };
  }

  if (input.leaksAfter !== 0 || !rolesAndSectionsAreExact(
    input.html,
    manifest.data.orderedRoles,
    manifest.data.selectedSectionIds,
    manifest.data.selectedContentHashes,
  )) {
    return { ok: false, reasonCode: "section_role_coverage_failed" };
  }
  if (!hasOriginalSectionProvenance({
    contentHashes: manifest.data.selectedContentHashes,
    sourceKinds: manifest.data.selectedSourceKinds,
    sourceTemplateIds: manifest.data.selectedSourceTemplateIds,
    sourceBandOrdinals: manifest.data.selectedSourceBandOrdinals,
  })) {
    return { ok: false, reasonCode: "section_originality_failed" };
  }
  if (!hasOneCreativeMarker(input.html)) {
    return { ok: false, reasonCode: "creative_marker_invalid" };
  }

  const outputHash = sha256(input.html);
  if (manifest.data.outputHash !== outputHash) {
    return { ok: false, reasonCode: "output_hash_mismatch" };
  }
  const repair = record(metadata.repair);
  if (metadata.repair !== undefined && (!repair || repair.accepted !== true)) {
    return { ok: false, reasonCode: "invalid_composition_metadata" };
  }
  if (repair && repair.outputHashAfter !== outputHash) {
    return { ok: false, reasonCode: "output_hash_mismatch" };
  }
  if (!assetsAreValid(metadata)) {
    return { ok: false, reasonCode: "asset_metadata_invalid" };
  }

  return { ok: true, visualEngine: input.visualEngine as CompositionMetadata };
}
