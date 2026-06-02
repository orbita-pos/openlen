// Deterministic variant selection for the assembler. When the recipe names a
// section TYPE but leaves the variant null, pickVariant chooses one from the
// library using ONLY the signals that actually exist (there is no family/style
// column): mode-match with the page theme (dominant — keeps the token bind safe,
// a dark section on a dark page), radius-feel proximity, and a slight nudge away
// from JS-driven variants (simpler = safer stitch). Layout uniformity comes from
// the bind, so variant choice only affects layout — every candidate is already
// curated to be good, so "good-enough deterministic" is the right bar here.

import { listSections, type SectionRecord } from "./store";
import type { SectionMode, SectionType } from "./types";
import type { AssembleTheme } from "./assemble";

type Bucket = "sharp" | "medium" | "soft";
const BUCKETS: Bucket[] = ["sharp", "medium", "soft"];

function radiusBucket(px: number): Bucket {
  return px <= 6 ? "sharp" : px <= 15 ? "medium" : "soft";
}

function parsePx(v: string | undefined | null): number | null {
  if (!v) return null;
  const m = /(-?\d*\.?\d+)\s*(px|rem|em)?/i.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /^(rem|em)$/i.test(m[2] ?? "px") ? n * 16 : n; // rem/em ≈ 16px
}

function isLightish(m: SectionMode): boolean {
  return m === "light" || m === "cream";
}

// Mode is the dominant axis: an exact match keeps the bind safe; light/cream are
// interchangeable-ish; dark↔light is the inversion-risk case we avoid.
function modeScore(sec: SectionMode, page: SectionMode): number {
  if (sec === page) return 100;
  if (isLightish(sec) && isLightish(page)) return 60;
  return 0;
}

/** Pure: higher = better fit for the page theme. */
export function scoreVariant(rec: SectionRecord, theme: AssembleTheme): number {
  let score = modeScore(rec.mode, theme.mode);
  const secPx = parsePx(rec.designTokens?.["--radius"]);
  if (secPx != null) {
    const themePx = (parsePx(theme.radius) ?? 10) * (parseFloat(theme.rScale ?? "1") || 1);
    const d = Math.abs(BUCKETS.indexOf(radiusBucket(secPx)) - BUCKETS.indexOf(radiusBucket(themePx)));
    score += d === 0 ? 10 : d === 1 ? 5 : 0;
  }
  if (rec.needsJs) score -= 3;
  return score;
}

/** Pure: best-first, deterministic (ties broken by slug for reproducibility). */
export function rankVariants(recs: SectionRecord[], theme: AssembleTheme): SectionRecord[] {
  return recs
    .map((r) => ({ r, s: scoreVariant(r, theme) }))
    .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))
    .map((x) => x.r);
}

/** Pick the best published variant of `type` for the theme. `seed` rotates among
 *  the top-scoring group so repeated generations don't always yield the same
 *  variant (deterministic given the seed). Returns null if the type is empty. */
export async function pickVariant(
  type: SectionType,
  theme: AssembleTheme,
  opts?: { seed?: number },
): Promise<SectionRecord | null> {
  const recs = await listSections({ type, status: "published" });
  if (recs.length === 0) return null;
  const ranked = rankVariants(recs, theme);
  const topScore = scoreVariant(ranked[0], theme);
  const topGroup = ranked.filter((r) => scoreVariant(r, theme) === topScore);
  const seed = opts?.seed ?? 0;
  return topGroup[((seed % topGroup.length) + topGroup.length) % topGroup.length];
}

/** Resolve a recipe's section list into concrete {slug, type} picks ready for
 *  stitchSections: explicit variants pass through; null variants are filled by
 *  pickVariant. Skips a type the library can't satisfy. */
export async function selectVariants(
  recipe: { type: SectionType; variant?: string | null }[],
  theme: AssembleTheme,
  opts?: { seed?: number },
): Promise<{ slug: string; type: SectionType }[]> {
  const out: { slug: string; type: SectionType }[] = [];
  let seed = opts?.seed ?? 0;
  for (const item of recipe) {
    if (item.variant) {
      out.push({ slug: item.variant, type: item.type });
      continue;
    }
    const rec = await pickVariant(item.type, theme, { seed });
    seed++;
    if (rec) out.push({ slug: rec.id, type: item.type });
  }
  return out;
}
