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

// Index of the ">" that closes the tag starting at `open`, skipping any ">"
// inside a quoted attribute value. Mirrors strip-disabled-bands.ts.
function openTagEnd(html: string, open: number): number {
  let quote: string | null = null;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

const ATTR_TOKEN_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

// Is `name` a genuine attribute in `tagText` — not merely a substring inside
// another attribute's quoted value (e.g. title="see data-ol-platforms-section
// docs")? Walks attribute TOKENS instead of a raw substring search.
function hasAttr(tagText: string, name: string): boolean {
  ATTR_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_TOKEN_RE.exec(tagText))) {
    if (m[1] === name) return true;
    if (m.index === ATTR_TOKEN_RE.lastIndex) ATTR_TOKEN_RE.lastIndex++;
  }
  return false;
}

// Every <section|div> genuinely carrying `marker` as an attribute (open-tag
// end index, so the caller can start filling right after it). Linear,
// guarded like stripBandByMarker so adversarial repeats of the marker text
// can't spin — and skips past a false hit (marker text sitting inside an
// unrelated attribute's quoted value) instead of stopping.
function findMarkerBands(html: string, marker: string): Array<{ tag: string; openEnd: number }> {
  const hits: Array<{ tag: string; openEnd: number }> = [];
  let from = 0;
  for (let guard = 0; guard < 200; guard++) {
    const idx = html.indexOf(marker, from);
    if (idx === -1) break;
    const tagStart = html.lastIndexOf("<", idx);
    if (tagStart === -1) {
      from = idx + marker.length;
      continue;
    }
    const tagMatch = /^<(section|div)\b/i.exec(html.slice(tagStart, tagStart + 9));
    if (!tagMatch) {
      from = idx + marker.length;
      continue;
    }
    const tagEnd = openTagEnd(html, tagStart);
    if (tagEnd === -1) {
      from = idx + marker.length;
      continue;
    }
    if (hasAttr(html.slice(tagStart, tagEnd), marker)) {
      hits.push({ tag: tagMatch[1].toLowerCase(), openEnd: tagEnd + 1 });
    }
    from = tagEnd + 1;
  }
  return hits;
}

/** Rellena el placeholder de la banda con la rejilla de tarjetas — en TODAS
 *  las bandas del documento, no solo la primera. Sin ninguna plataforma
 *  armable borra la banda ENTERA — un encabezado "Encuéntrame en" sobre un
 *  hueco vacío rompería Born-100. Idempotente: reemplaza el CONTENIDO de
 *  cada elemento marcado, así que re-sembrar no duplica. */
export function fillPlatformsBand(html: string, data: BusinessProfileData): string {
  const hits = findMarkerBands(html, PLATFORMS_BAND_MARKER);
  if (hits.length === 0) return html;

  const grid = renderPlatformsBand(data);
  if (!grid) return stripBandByMarker(html, PLATFORMS_BAND_MARKER);

  let out = html;
  for (let i = hits.length - 1; i >= 0; i--) {
    const { tag, openEnd } = hits[i];
    const closeStart = matchingCloseStart(out, openEnd, tag);
    if (closeStart === -1) continue;
    out = out.slice(0, openEnd) + grid + out.slice(closeStart);
  }
  return out;
}
