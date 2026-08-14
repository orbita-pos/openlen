import { parse } from "node-html-parser";

import {
  AssetManifestSchema,
  AssetResolutionTraceSchema,
  validateAssetManifestHash,
} from "@/lib/generation/asset-contracts";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { CreativeDocumentManifestSchema } from "@/lib/generation/creative-document-contracts";
import { sha256 } from "@/lib/generation/content-hash";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

export type CreativeDocumentMetadata = Extract<VisualEngineProjectMetadata, { route: "creative_document" }>;

export type CreativeDocumentDeliveryReason =
  | "invalid_document_metadata"
  | "invalid_document_manifest"
  | "document_shape_invalid"
  | "reserved_marker"
  | "unsealed_document"
  | "output_hash_mismatch"
  | "asset_metadata_invalid";

const RESERVED_MARKER = /\bdata-slot-path\s*=/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validMetadataShape(value: Record<string, unknown>): boolean {
  return value.schemaVersion === "visual-engine-project/1.0"
    && value.route === "creative_document"
    && value.templateId === null
    && typeof value.promptVersion === "string"
    && value.promptVersion.length > 0
    && typeof value.policyVersion === "string"
    && value.policyVersion.length > 0
    && value.contractVersion === "creative-direction/1.0";
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

/**
 * The delivery contract for an authored page. It asserts what a published
 * OpenLen document must be — a titled, sealed, marker-free HTML document whose
 * hash matches its metadata — and deliberately says nothing about how the model
 * chose to structure it. Section roles, `data-sec` provenance, and the
 * creative-direction marker belong to the composed route, not to this one.
 */
export function isDeliverableDocument(html: string): boolean {
  if (RESERVED_MARKER.test(html)) return false;
  const root = parse(html);
  if (!root.querySelector("html") || !root.querySelector("head") || !root.querySelector("body")) return false;
  const title = root.querySelector("head title")?.textContent?.trim() ?? "";
  if (title.length === 0) return false;
  return (root.querySelector("body")?.textContent?.trim().length ?? 0) > 0;
}

export function isSealedDocument(html: string): boolean {
  return parse(html).querySelectorAll("meta[data-ol-csp]").length === 1;
}

export function validateCreativeDocumentDelivery(input: {
  html: string;
  visualEngine: unknown;
}):
  | { ok: true; visualEngine: CreativeDocumentMetadata }
  | { ok: false; reasonCode: CreativeDocumentDeliveryReason } {
  const metadata = record(input.visualEngine);
  if (!metadata || !validMetadataShape(metadata)) {
    return { ok: false, reasonCode: "invalid_document_metadata" };
  }
  if (!CreativeDirectionSchema.safeParse(metadata.creativeDirection).success) {
    return { ok: false, reasonCode: "invalid_document_metadata" };
  }
  const manifest = CreativeDocumentManifestSchema.safeParse(metadata.documentManifest);
  if (!manifest.success || manifest.data.resultCode !== "authored") {
    return { ok: false, reasonCode: "invalid_document_manifest" };
  }
  if (RESERVED_MARKER.test(input.html)) {
    return { ok: false, reasonCode: "reserved_marker" };
  }
  if (!isDeliverableDocument(input.html)) {
    return { ok: false, reasonCode: "document_shape_invalid" };
  }
  if (!isSealedDocument(input.html)) {
    return { ok: false, reasonCode: "unsealed_document" };
  }

  const outputHash = sha256(input.html);
  if (manifest.data.outputHash !== outputHash) {
    return { ok: false, reasonCode: "output_hash_mismatch" };
  }
  const repair = record(metadata.repair);
  if (metadata.repair !== undefined && (!repair || repair.accepted !== true)) {
    return { ok: false, reasonCode: "invalid_document_metadata" };
  }
  if (repair && repair.outputHashAfter !== outputHash) {
    return { ok: false, reasonCode: "output_hash_mismatch" };
  }
  if (!assetsAreValid(metadata)) {
    return { ok: false, reasonCode: "asset_metadata_invalid" };
  }

  return { ok: true, visualEngine: input.visualEngine as CreativeDocumentMetadata };
}
