// The deterministic "brand seed" shared by every creation path: recolour a page
// to the profile's brand accent + append its contact/links widget. Both no-op
// when the profile has nothing to show, so an EMPTY profile leaves the HTML
// untouched (Business SEEDS, never gates).
//
// Operates on ALREADY-normalized HTML (post normalizeBornCanonical, which
// exposes the --ol-accent tokens applyAccentToHtml overrides). Each caller still
// runs its own normalize + ensurePageMeta around this.
//
// Idempotent: strips any prior accent <style> / contact widget first, so
// re-seeding an already-seeded page (the "Hazla tuya" re-fill) never duplicates.

import type { BusinessProfileData } from "./types";
import { applyAccentToHtml } from "./apply-accent";
import { injectContactWidget } from "./contact-widget";

const DEFAULT_ACCENT = "#FF5A36";

// Remove a previously-seeded accent <style> + contact widget. No-op on a fresh
// page that was never seeded (the common create path), so output is byte-equal.
function stripPriorSeed(html: string): string {
  return html
    .replace(/<style data-ol-accent-applied>[\s\S]*?<\/style>/i, "")
    .replace(/<div data-ol-contact-widget[\s\S]*?<\/div>/i, "");
}

/** Apply the profile's brand accent + contact widget to normalized HTML.
 *  No-op for an empty profile (no accent → tokens unchanged; no contact →
 *  injectContactWidget returns the html as-is).
 *
 *  `recolor` (default true) overrides the page's accent token to the brand
 *  colour — right for AI-built pages (curate/generate). Pass `recolor: false`
 *  for user-BROUGHT designs (clone a template / paste your own HTML): keep the
 *  look they chose, but still surface their real contact (the widget itself is
 *  always brand-coloured — it's a new element, not a recolour of their design). */
export function seedBrandIntoHtml(
  html: string,
  data: BusinessProfileData,
  opts: { recolor?: boolean } = {},
): string {
  const { recolor = true } = opts;
  const accent = data.brand?.accent ?? null;
  let out = stripPriorSeed(html);
  if (recolor && accent) out = applyAccentToHtml(out, accent);
  out = injectContactWidget(out, data, accent ?? DEFAULT_ACCENT);
  return out;
}

/** The page-meta fields a profile seeds (logo → favicon, first photo → og). */
export function profileMeta(data: BusinessProfileData): {
  logoUrl?: string;
  ogImage?: string;
} {
  return {
    logoUrl: data.brand?.logoUrl ?? undefined,
    ogImage: data.photos?.[0] ?? undefined,
  };
}
