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

function canonicalStorageKey(id: string, hash: string): string {
  return `sections/${id}-${hash}.html`;
}

const SECTION_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{12}$/;

function hasCanonicalSectionId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && SECTION_ID_PATTERN.test(value);
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
  if (published.some((record) =>
    !hasCanonicalSectionId(record.id) || !CONTENT_HASH_PATTERN.test(record.contentHash))) {
    throw new SectionCompositionSelectionError("section_inventory_stale");
  }
  if (published.some((record) => record.storageKey !== canonicalStorageKey(record.id, record.contentHash))) {
    throw new SectionCompositionSelectionError("section_inventory_stale");
  }
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

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS = new Set([
  "script", "style", "textarea", "title", "iframe", "xmp", "noembed", "noframes",
]);
const SVG_HTML_INTEGRATION_POINTS = new Set(["foreignobject", "desc", "title"]);
const MATHML_HTML_INTEGRATION_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);

type MarkupNamespace = "html" | "svg" | "math";

interface OpenElement {
  name: string;
  namespace: MarkupNamespace;
}

function childNamespace(openTags: readonly OpenElement[]): MarkupNamespace {
  const parent = openTags.at(-1);
  if (!parent) return "html";
  if (parent.namespace === "svg" && SVG_HTML_INTEGRATION_POINTS.has(parent.name)) {
    return "html";
  }
  if (parent.namespace === "math" && MATHML_HTML_INTEGRATION_POINTS.has(parent.name)) {
    return "html";
  }
  return parent.namespace;
}

function elementNamespace(parentNamespace: MarkupNamespace, name: string): MarkupNamespace {
  if (parentNamespace !== "html") return parentNamespace;
  if (name === "svg") return "svg";
  if (name === "math") return "math";
  return "html";
}

function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function attributeValue(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\s${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))`, "i").exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : null;
}

function hasValidFragmentShape(html: string, sectionId: string): boolean {
  const openTags: OpenElement[] = [];
  let nonStyleLinkRoots = 0;
  let matchingMarkerRoots = 0;
  let matchingMarkers = 0;
  let index = 0;

  while (index < html.length) {
    const rawTag = openTags.at(-1);
    if (rawTag?.namespace === "html" && RAW_TEXT_TAGS.has(rawTag.name)) {
      const closing = new RegExp(`<\\/\\s*${rawTag.name}\\s*>`, "i").exec(html.slice(index));
      if (!closing || closing.index === undefined) return false;
      index += closing.index + closing[0].length;
      openTags.pop();
      continue;
    }
    const next = html.indexOf("<", index);
    if (next === -1) {
      if (openTags.length === 0 && html.slice(index).trim()) return false;
      break;
    }
    if (openTags.length === 0 && html.slice(index, next).trim()) return false;
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      if (end === -1) return false;
      index = end + 3;
      continue;
    }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) return false;
    const end = tagEnd(html, next + 1);
    if (end === -1) return false;
    const tag = html.slice(next, end + 1);
    const closing = /^<\/\s*([a-z][a-z0-9:-]*)\s*>$/i.exec(tag);
    if (closing) {
      const name = closing[1].toLowerCase();
      if (["html", "head", "body"].includes(name) || openTags.at(-1)?.name !== name) return false;
      openTags.pop();
      index = end + 1;
      continue;
    }
    const opening = /^<\s*([a-z][a-z0-9:-]*)\b[^>]*>$/i.exec(tag);
    if (!opening) return false;
    const name = opening[1].toLowerCase();
    if (["html", "head", "body"].includes(name)) return false;
    const root = openTags.length === 0;
    const marker = attributeValue(tag, "data-sec");
    if (marker === sectionId) matchingMarkers += 1;
    if (root && name !== "style" && name !== "link") {
      nonStyleLinkRoots += 1;
      if (marker === sectionId) matchingMarkerRoots += 1;
    }
    const namespace = elementNamespace(childNamespace(openTags), name);
    const selfClosing = /\/\s*>$/.test(tag);
    // HTML ignores a self-closing solidus on non-void elements. SVG and MathML
    // foreign content honor it, except at their bounded HTML integration points.
    if (!VOID_TAGS.has(name) && !(namespace !== "html" && selfClosing)) {
      openTags.push({ name, namespace });
    }
    index = end + 1;
  }

  return openTags.length === 0 && nonStyleLinkRoots === 1 && matchingMarkerRoots === 1 && matchingMarkers === 1;
}

export async function fetchVerifiedSectionFragments(
  selection: readonly SectionSelectionRow[],
  inventory: SectionCompositionInventory,
  deps: { fetchText: (storageUrl: string) => Promise<string | null> },
): Promise<
  | { ok: true; fragments: VerifiedSectionFragment[] }
  | { ok: false; code: "section_fragment_unavailable" | "section_fragment_stale" | "section_fragment_invalid" | "section_inventory_stale" }
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
    if (!hasValidFragmentShape(html, row.sectionId)) {
      return { ok: false, code: "section_fragment_invalid" };
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
