// Apply a saved business profile's brand ACCENT to a curated page, server-side.
// The page has already been through normalizeBornCanonical, which hoists the
// template's accent onto the `--ol-accent` / `--ol-accent-r` / `--ol-accent-ink`
// CSS tokens and rewrites hardcoded uses to var(). So recolouring to the brand
// accent is just overriding those three tokens via a :root <style> at the very
// end of <head> (last wins). We deliberately override ONLY the accent (not bg/
// surface/fg) so the template keeps its own mood — just its accent becomes the
// user's brand colour, with a re-derived readable ink for text-on-accent.

import { deriveAccentInk } from "@/lib/theme-derive";

function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

function hexTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Override the page's accent tokens with the brand accent. No-op if the accent
 *  isn't a valid 6-digit hex. */
export function applyAccentToHtml(html: string, accent: string): string {
  const hex = normalizeHex(accent);
  if (!hex) return html;
  const block = `<style data-ol-accent-applied>:root{--ol-accent:${hex};--ol-accent-r:${hexTriplet(
    hex,
  )};--ol-accent-ink:${deriveAccentInk(hex)};}</style>`;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${block}</head>`)
    : block + html;
}
