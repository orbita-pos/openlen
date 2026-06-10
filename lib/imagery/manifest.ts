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
}

// Transparent cutouts break full-bleed slots; the branded drops (LUME /
// Japan / World Cup) are off-subject for generic briefs. Mirrors the
// exclusions the proven photo-migration matcher used (scripts/variants-fill).
const EXCLUDE_ID = /nobg|lume|japan|worldcup/i;
// pet-editorial almost never fits a generic landing brief.
const EXCLUDE_STYLE = new Set(["pet-editorial"]);

let cache: CuratedImage[] | null = null;

export async function loadCuratedImages(): Promise<CuratedImage[]> {
  if (cache) return cache;
  const file = path.join(
    process.cwd(),
    "public",
    "openlen-images",
    "manifest.json",
  );
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const arr = Array.isArray(raw)
    ? raw
    : ((raw as { images?: unknown[]; items?: unknown[] })?.images ??
        (raw as { items?: unknown[] })?.items ??
        Object.values(raw as object).find(Array.isArray) ??
        []);
  cache = (arr as CuratedImage[]).filter(
    (e) =>
      e &&
      typeof e.id === "string" &&
      e.src?.hero &&
      !EXCLUDE_ID.test(e.id) &&
      !EXCLUDE_STYLE.has(e.style),
  );
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
