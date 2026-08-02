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
import { renderPlatformsBand, PLATFORMS_BAND_MARKER } from "./platforms-band";
import { stripBandByMarker } from "@/lib/publish/strip-disabled-bands";

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
  out = fillPlatformsBand(out, data);
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

// Depth-aware match for the marker element's OWN close tag, starting just
// after its open tag. buildModuleSection wraps the marker in a plain <div>,
// and renderPlatformsBand's grid is itself a <div> — a naive first-`</div>`
// search would land on the grid's own close on re-seed, leaving a stray
// unmatched </div> behind. Same linear single-pass technique as elementEnd
// in strip-disabled-bands.ts.
function matchingCloseStart(html: string, contentStart: number, tag: string): number {
  const scan = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
  scan.lastIndex = contentStart;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html))) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

/** Rellena el placeholder de la banda con la rejilla de tarjetas. Sin ninguna
 *  plataforma armable borra la banda ENTERA — un encabezado "Encuéntrame en"
 *  sobre un hueco vacío rompería Born-100. Idempotente: reemplaza el CONTENIDO
 *  del elemento marcado, así que re-sembrar no duplica. */
export function fillPlatformsBand(html: string, data: BusinessProfileData): string {
  const open = new RegExp(`<(section|div)[^>]*\\b${PLATFORMS_BAND_MARKER}\\b[^>]*>`, "i").exec(html);
  if (!open) return html;

  const grid = renderPlatformsBand(data);
  if (!grid) return stripBandByMarker(html, PLATFORMS_BAND_MARKER);

  const tag = open[1];
  const at = open.index + open[0].length;
  const closeStart = matchingCloseStart(html, at, tag);
  if (closeStart === -1) return html;
  return html.slice(0, at) + grid + html.slice(closeStart);
}
