import { parse } from "node-html-parser";

import {
  AssetManifestSchema,
  validateAssetManifestHash,
  type AssetManifest,
} from "@/lib/generation/asset-contracts";
import {
  fingerprintStructure,
  replaceableContentImages,
  structureIsPreserved,
} from "@/lib/generation/structural-fingerprint";

const MAX_INVENTORY_ASSET_SLOTS = 12;

export interface ApplyAssetManifestInput {
  html: string;
  manifest: AssetManifest;
  inputFingerprint: string;
}

export type AppliedAssetManifestResult =
  | { ok: true; html: string; manifest: AssetManifest }
  | { ok: false; code: "asset_slot_unavailable" | "structural_invariant_failed" };

function rawSlotIndexes(manifest: unknown): number[] | null {
  if (manifest === null || typeof manifest !== "object") return null;
  const slots = (manifest as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return null;
  const indexes: number[] = [];
  for (const slot of slots) {
    if (slot === null || typeof slot !== "object" || !Number.isInteger((slot as { slotIndex?: unknown }).slotIndex)) return null;
    indexes.push((slot as { slotIndex: number }).slotIndex);
  }
  return indexes;
}

export function applyAssetManifest(input: ApplyAssetManifestInput): AppliedAssetManifestResult {
  const indexes = rawSlotIndexes(input.manifest);
  if (indexes && new Set(indexes).size !== indexes.length) {
    return { ok: false, code: "asset_slot_unavailable" };
  }

  const manifest = AssetManifestSchema.safeParse(input.manifest);
  if (!manifest.success || !validateAssetManifestHash(input.manifest)) {
    return { ok: false, code: "structural_invariant_failed" };
  }

  try {
    const root = parse(input.html);
    const images = replaceableContentImages(root).slice(0, MAX_INVENTORY_ASSET_SLOTS);
    const allReplaceableSlots = images.map((_image, slotIndex) => slotIndex);
    if (fingerprintStructure(input.html, { allowedAssetSlots: allReplaceableSlots }) !== input.inputFingerprint) {
      return { ok: false, code: "structural_invariant_failed" };
    }

    for (const slot of manifest.data.slots) {
      const image = images[slot.slotIndex];
      if (!image) return { ok: false, code: "asset_slot_unavailable" };
      image.setAttribute("src", slot.resolution.url);
      if (image.hasAttribute("srcset")) image.setAttribute("srcset", slot.resolution.url);
      image.setAttribute("alt", slot.intent.alt);
    }

    const html = root.toString();
    const allowedAssetSlots = manifest.data.slots.map((slot) => slot.slotIndex);
    if (!structureIsPreserved(input.html, html, { allowedAssetSlots })) {
      return { ok: false, code: "structural_invariant_failed" };
    }
    return { ok: true, html, manifest: manifest.data };
  } catch {
    return { ok: false, code: "structural_invariant_failed" };
  }
}
