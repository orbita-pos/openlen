import { createHash } from "node:crypto";

import type { CreativeDirection } from "./creative-contracts";
import type { SectionPlan, SectionPlanRow } from "./section-composition-contracts";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { rankCompositionVariants } from "@/lib/sections/select";
import type { SectionRecord } from "@/lib/sections/store";
import type { SectionMode, SectionType } from "@/lib/sections/types";

export type SectionRadiusBucket = "sharp" | "medium" | "soft" | "unknown";
export type SectionDensity =
  | CreativeDirection["geometry"]["density"]
  | "unknown";
export type SectionAssetCapability = "replaceable" | "none";

export interface SectionCompositionInventoryEntry {
  id: string;
  type: SectionType;
  mode: SectionMode;
  contentHash: string;
  radiusBucket: SectionRadiusBucket;
  density: SectionDensity;
  needsJs: boolean;
  assetCapability: SectionAssetCapability;
}

export interface SectionCompositionInventory {
  readonly schemaVersion: "section-composition-inventory/1.0";
  readonly hash: string;
  readonly entries: readonly SectionCompositionInventoryEntry[];
}

export interface SectionSelectionRow extends SectionPlanRow {
  inventoryHash: string;
  sectionId: string;
  contentHash: string;
}

export interface VerifiedSectionFragment {
  slug: string;
  type: SectionType;
  requestedRole: SectionPlanRow["requestedRole"];
  html: string;
}

type SelectionFailureCode =
  | "section_inventory_stale"
  | "section_fragment_unavailable"
  | "section_role_coverage_failed";

export class SectionCompositionSelectionError extends Error {
  constructor(readonly code: SelectionFailureCode) {
    super(code);
    this.name = "SectionCompositionSelectionError";
  }
}

interface FrozenSource {
  storageUrl: string;
  contentHash: string;
}

const FROZEN_SOURCES = new WeakMap<
  SectionCompositionInventory,
  ReadonlyMap<string, FrozenSource>
>();

function radiusBucket(value: string | undefined): SectionRadiusBucket {
  if (!value) return "unknown";
  const match = /^\s*(-?\d*\.?\d+)\s*(px|rem|em)?\s*$/i.exec(value);
  if (!match) return "unknown";
  const unit = (match[2] ?? "px").toLowerCase();
  const pixels = Number(match[1]) * (unit === "px" ? 1 : 16);
  if (!Number.isFinite(pixels) || pixels < 0) return "unknown";
  if (pixels <= 6) return "sharp";
  if (pixels <= 15) return "medium";
  return "soft";
}

export function buildSectionCompositionInventory(
  records: readonly SectionRecord[],
): SectionCompositionInventory {
  const published = records
    .filter((record) => record.status === "published")
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = published.map((record) => record.id);
  if (new Set(ids).size !== ids.length) {
    throw new SectionCompositionSelectionError("section_inventory_stale");
  }
  const entries = Object.freeze(published.map((record) => Object.freeze({
    id: record.id,
    type: record.type,
    mode: record.mode,
    contentHash: record.contentHash,
    radiusBucket: radiusBucket(record.designTokens?.["--radius"]),
    density: "unknown" as const,
    needsJs: record.needsJs,
    assetCapability: record.hasPlaceholders ? "replaceable" as const : "none" as const,
  })));
  const inventory: SectionCompositionInventory = Object.freeze({
    schemaVersion: "section-composition-inventory/1.0",
    hash: canonicalJsonSha256(entries),
    entries,
  });
  FROZEN_SOURCES.set(
    inventory,
    new Map(published.map((record) => [record.id, {
      storageUrl: record.storageUrl,
      contentHash: record.contentHash,
    }])),
  );
  return inventory;
}

function stableSeed(plan: SectionPlan, row: SectionPlanRow): number {
  const seed = `${plan.intentHash}:${plan.inventoryHash}:${row.ordinal}:${row.requestedRole}`;
  return createHash("sha256").update(seed).digest().readUInt32BE(0);
}

export function resolveSectionPlan(
  plan: SectionPlan,
  inventory: SectionCompositionInventory,
  direction: CreativeDirection | null,
): SectionSelectionRow[] {
  if (plan.inventoryHash !== inventory.hash) {
    throw new SectionCompositionSelectionError("section_inventory_stale");
  }
  const used = new Set<string>();
  return plan.rows.map((row) => {
    const eligible = inventory.entries.filter((entry) =>
      entry.type === row.componentType && !entry.needsJs && !used.has(entry.id));
    const ranked = direction
      ? rankCompositionVariants(eligible, direction, { seed: stableSeed(plan, row) })
      : eligible.sort((left, right) => left.id.localeCompare(right.id));
    const selected = ranked[0];
    if (!selected) {
      throw new SectionCompositionSelectionError(
        inventory.entries.some((entry) => entry.type === row.componentType)
          ? "section_role_coverage_failed"
          : "section_fragment_unavailable",
      );
    }
    used.add(selected.id);
    return {
      ...row,
      inventoryHash: inventory.hash,
      sectionId: selected.id,
      contentHash: selected.contentHash,
    };
  });
}

function contentHash(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
}

export async function fetchVerifiedSectionFragments(
  selection: readonly SectionSelectionRow[],
  inventory: SectionCompositionInventory,
  deps: { fetchText: (storageUrl: string) => Promise<string | null> },
): Promise<
  | { ok: true; fragments: VerifiedSectionFragment[] }
  | { ok: false; code: "section_fragment_unavailable" | "section_fragment_stale" | "section_inventory_stale" }
> {
  if (selection.some((row) => row.inventoryHash !== inventory.hash)) {
    return { ok: false, code: "section_inventory_stale" };
  }
  const sources = FROZEN_SOURCES.get(inventory);
  if (!sources) return { ok: false, code: "section_inventory_stale" };
  const fragments: VerifiedSectionFragment[] = [];
  for (const row of selection) {
    const source = sources.get(row.sectionId);
    if (!source || source.contentHash !== row.contentHash) {
      return { ok: false, code: "section_inventory_stale" };
    }
    let html: string | null;
    try {
      html = await deps.fetchText(source.storageUrl);
    } catch {
      return { ok: false, code: "section_fragment_unavailable" };
    }
    if (html === null) return { ok: false, code: "section_fragment_unavailable" };
    if (contentHash(html) !== source.contentHash) {
      return { ok: false, code: "section_fragment_stale" };
    }
    fragments.push({
      slug: row.sectionId,
      type: row.componentType,
      requestedRole: row.requestedRole,
      html,
    });
  }
  return { ok: true, fragments };
}
