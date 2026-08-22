// Pick ONE curated template's full-page screenshot to attach as the
// multimodal reference for a free-form /api/generate brief (Quality S2).
//
// Strategy (v1 — keyword bag-of-words, no embeddings):
//   1. Classify the brief into a TemplateFamily by scoring accent-folded
//      keyword stems (English + Spanish — briefs arrive in both).
//   2. Within the matched family, rank `featured` templates first, then take
//      the first published one that actually HAS a screenshot.
//   3. Fallback: Mirror (our highest-quality canonical reference).
//   4. Hard fallback: if even Mirror has no screenshot, return null and let
//      the caller skip the image.
//
// The classifier is split out (pure, no DB) so it can be smoke-tested
// offline — see scripts/templates/test-select-reference.ts.

import { getTemplate, listTemplates, type TemplateRecord } from "./store";
import type { TemplateFamily } from "./families";
import { classifyBriefFamily, type BriefClassification } from "./classify-brief-family";

export { classifyBriefFamily, type BriefClassification };

const MIRROR_ID = "mirror";

// Keyword stems per family. Matching is accent-folded + lowercased; a
// single-word entry matches any brief token that STARTS WITH it (so
// "fotograf" catches "fotografía"/"fotógrafa"), a multi-word entry matches as
// a substring. Lists are deliberately broad and bilingual; precision comes
// from summing across keywords + the priority tiebreak below, not from any
// one term. This is the v1 the spec endorses — swap for embeddings later if
// classification quality demands it.

export interface ReferenceTemplate {
  id: string;
  screenshotUrl: string;
  family: TemplateFamily;
}

/** Rank `featured` first, then return the first record that actually has a
 *  screenshot (we can only attach one that's been captured). */
function pickWithScreenshot(records: TemplateRecord[]): TemplateRecord | null {
  const ranked = [...records].sort((a, b) => Number(b.featured) - Number(a.featured));
  return ranked.find((t) => !!t.screenshotUrl) ?? null;
}

export async function selectReferenceTemplate(
  brief: string,
): Promise<ReferenceTemplate | null> {
  const { family } = classifyBriefFamily(brief);

  if (family) {
    const inFamily = await listTemplates({ family });
    const pick = pickWithScreenshot(inFamily);
    if (pick?.screenshotUrl) {
      return { id: pick.id, screenshotUrl: pick.screenshotUrl, family: pick.family };
    }
  }

  // Fallback: Mirror — the canonical highest-quality reference.
  const mirror = await getTemplate(MIRROR_ID);
  if (mirror?.screenshotUrl) {
    return { id: mirror.id, screenshotUrl: mirror.screenshotUrl, family: mirror.family };
  }

  // Hard fallback: no usable reference. Caller skips the image.
  // eslint-disable-next-line no-console
  console.warn(
    `[select-reference] no reference screenshot available (family=${family ?? "none"}, mirror screenshot missing) — generating without a vision reference`,
  );
  return null;
}
