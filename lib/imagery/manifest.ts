// Typed access to the 502-image curated library (public/openlen-images/
// manifest.json) used by Born With Imagery to photograph AI-generated pages.
// Server-side only — the manifest is read from disk once and memoized.

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface CuratedImage {
  id: string;
  promptNum: number;
  /** e.g. "food-editorial", "3d-abstract", "architecture-editorial". */
  style: string;
  /** Template-family tags this image suits (e.g. ["saas","portfolio"]). */
  family: string[];
  alt: string;
  src: { hero: string; tablet: string; thumb: string };
  domains?: string[];
  audiences?: string[];
  visualSignals?: string[];
  negativeTags?: string[];
  mediaType?: "photo" | "illustration" | "texture";
  license?: "openlen_catalog";
  checksum?: string;
}

// Transparent cutouts break full-bleed slots; the branded drops (LUME /
// Japan / World Cup) are off-subject for generic briefs. Mirrors the
// exclusions the proven photo-migration matcher used (scripts/variants-fill).
const EXCLUDE_ID = /nobg|lume|japan|worldcup/i;
// pet-editorial almost never fits a generic landing brief.
const EXCLUDE_STYLE = new Set(["pet-editorial"]);

let cache: CuratedImage[] | null = null;

const TAXONOMY_TAG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CHECKSUM = /^sha256:[a-f0-9]{64}$/;

function reviewedList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 12 || value.some((item) => typeof item !== "string" || !TAXONOMY_TAG.test(item))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value];
}

function parseRow(value: unknown): CuratedImage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const src = row.src;
  if (
    typeof row.id !== "string"
    || typeof row.promptNum !== "number"
    || !Number.isFinite(row.promptNum)
    || typeof row.style !== "string"
    || !Array.isArray(row.family)
    || row.family.some((item) => typeof item !== "string")
    || typeof row.alt !== "string"
    || !src
    || typeof src !== "object"
  ) return null;
  const source = src as Record<string, unknown>;
  if (typeof source.hero !== "string" || !source.hero || typeof source.tablet !== "string" || !source.tablet || typeof source.thumb !== "string" || !source.thumb) return null;

  const parsed: CuratedImage = {
    id: row.id,
    promptNum: row.promptNum,
    style: row.style,
    family: [...row.family] as string[],
    alt: row.alt,
    src: { hero: source.hero, tablet: source.tablet, thumb: source.thumb },
  };
  for (const field of ["domains", "audiences", "visualSignals", "negativeTags"] as const) {
    if (!(field in row)) continue;
    const list = reviewedList(row[field]);
    if (!list) return null;
    parsed[field] = list;
  }
  if ("mediaType" in row) {
    if (row.mediaType !== "photo" && row.mediaType !== "illustration" && row.mediaType !== "texture") return null;
    parsed.mediaType = row.mediaType;
  }
  if ("license" in row) {
    if (row.license !== "openlen_catalog") return null;
    parsed.license = row.license;
  }
  if ("checksum" in row) {
    if (typeof row.checksum !== "string" || !CHECKSUM.test(row.checksum)) return null;
    parsed.checksum = row.checksum;
  }
  return parsed;
}

function manifestRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const record = raw as { images?: unknown; items?: unknown } & Record<string, unknown>;
  if (Array.isArray(record.images)) return record.images;
  if (Array.isArray(record.items)) return record.items;
  return Object.values(record).find(Array.isArray) ?? [];
}

export function parseCuratedImageManifest(raw: unknown): CuratedImage[] {
  return manifestRows(raw)
    .map(parseRow)
    .filter((image): image is CuratedImage => image !== null)
    .filter((image) => !EXCLUDE_ID.test(image.id) && !EXCLUDE_STYLE.has(image.style));
}

export async function loadCuratedImages(): Promise<CuratedImage[]> {
  if (cache) return cache;
  const file = path.join(
    process.cwd(),
    "public",
    "openlen-images",
    "manifest.json",
  );
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  cache = parseCuratedImageManifest(raw);
  return cache;
}

/** Test seam — inject a fixture library instead of reading disk. */
export function __setCuratedImagesForTest(imgs: CuratedImage[] | null): void {
  cache = imgs;
}

const DARK =
  /\b(deep|dark|midnight|indigo|charcoal|noir|black|neon|volumetric|aurora|obsidian|graphite|ink|shadow|night|twilight|cosmic|void|cool|moody|emerald|sapphire)\b/i;
const LIGHT =
  /\b(cream|ivory|white|peach|pastel|soft|light|pale|blush|sand|linen|daylight|airy|bright|warm|gallery|porcelain|sunlit|honey)\b/i;

/** Tone of an image, inferred from its alt text (same heuristic the
 *  photo-migration used). Returns "dark" | "light" | "neutral". */
export function imageTone(alt: string): "dark" | "light" | "neutral" {
  if (DARK.test(alt)) return "dark";
  if (LIGHT.test(alt)) return "light";
  return "neutral";
}
