// Publish-time cleanup: a content module that is OFF must not ship its band.
// Persisted bands (buildModuleSection surfaces, legacy dashed sections, or
// AI-emitted placeholder divs) stay in data.html when a module is toggled
// off — the bakes are gated on `enabled`, so nothing wired the widget and
// the published page showed a heading over nothing (or a dashed box).
//
// Removal rules, conservative on purpose:
//   • OUR designed band (band() signature: <section style="max-width:…;
//     margin:64px auto;…"> enclosing the marker with no </section> in
//     between) → remove the WHOLE band, heading — and any user content the
//     AI nested inside it — included (documented rule: customized band goes
//     whole; never a partial cut with orphan closers).
//   • Otherwise → remove ONLY the marker element (depth-aware close, so
//     nested same-tag children go with it and siblings survive).
// Linear index scanning throughout — the first cut used regexes whose
// tempered/lazy quantifiers measured O(n²) on adversarial band-opener spam
// (an 8MB from-html paste could pin the box's event loop for minutes at
// publish). Pure string, no DOM. Idempotent. Enabled modules untouched.

import { hasAttr, openTagEnd } from "./tag-attrs";

const MARKERS = {
  bookings: "data-ol-bookings-section",
  collections: "data-ol-collection-section",
  comments: "data-ol-comments-section",
  chat: "data-ol-chat-section",
} as const;

export type StrippableModule = keyof typeof MARKERS;

const BAND_OPEN_PREFIX = '<section style="max-width:';
const BAND_OPEN_SIGNATURE = "margin:64px auto;";

/** End index (exclusive) of the element whose open tag starts at `open`,
 *  matching nested same-name tags; -1 when the close is missing. Linear. */
function elementEnd(html: string, open: number, tag: string): number {
  const scan = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
  scan.lastIndex = open + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return scan.lastIndex;
  }
  return -1;
}

/** Borra la banda entera que contiene `marker`. Escaneo lineal, idempotente. */
export function stripBandByMarker(html: string, marker: string): string {
  let out = html;
  let from = 0;
  for (let guard = 0; guard < 200; guard++) {
    const idx = out.indexOf(marker, from);
    if (idx === -1) break;

    // The element carrying the marker: walk back to its opening "<".
    const tagStart = out.lastIndexOf("<", idx);
    if (tagStart === -1) {
      from = idx + marker.length;
      continue;
    }
    const tagMatch = /^<(section|div)\b/i.exec(out.slice(tagStart, tagStart + 9));
    if (!tagMatch) {
      from = idx + marker.length;
      continue;
    }
    const openEnd = openTagEnd(out, tagStart);
    if (openEnd === -1) {
      from = idx + marker.length;
      continue;
    }
    if (!hasAttr(out.slice(tagStart, openEnd), marker)) {
      // The marker text is only inside an unrelated attribute's quoted
      // value on THIS tag — skip past it and keep scanning.
      from = openEnd + 1;
      continue;
    }
    const tagName = tagMatch[1].toLowerCase();
    const elEnd = elementEnd(out, tagStart, tagName);
    if (elEnd === -1) {
      from = idx + marker.length;
      continue;
    }

    // Enclosing designed band? Nearest band-opener BEFORE the element whose
    // section hasn't closed in between. One candidate check — adversarial
    // opener spam degrades to "no band", never to a rescan.
    let removeStart = tagStart;
    let removeEnd = elEnd;
    if (tagName !== "section") {
      const bandOpen = out.lastIndexOf(BAND_OPEN_PREFIX, tagStart);
      if (bandOpen !== -1) {
        const bandTagEnd = out.indexOf(">", bandOpen);
        const between = out.slice(bandOpen, tagStart);
        const openTag = bandTagEnd === -1 ? "" : out.slice(bandOpen, bandTagEnd + 1);
        if (
          openTag.includes(BAND_OPEN_SIGNATURE) &&
          !between.slice(openTag.length).toLowerCase().includes("</section>") &&
          !between.slice(openTag.length).toLowerCase().includes("<section")
        ) {
          const bandEnd = elementEnd(out, bandOpen, "section");
          if (bandEnd !== -1) {
            removeStart = bandOpen;
            removeEnd = bandEnd;
          }
        }
      }
    }

    out = out.slice(0, removeStart) + out.slice(removeEnd);
    from = removeStart;
  }
  return out;
}

/** Remove the bands of every module flagged OFF. Flags mirror the publish
 *  ctx gates: `false` = module disabled → its band must not ship. */
export function stripDisabledModuleBands(
  html: string,
  enabled: Record<StrippableModule, boolean>,
): string {
  let out = html;
  for (const mod of Object.keys(MARKERS) as StrippableModule[]) {
    if (enabled[mod]) continue;
    if (!out.includes(MARKERS[mod])) continue;
    out = stripBandByMarker(out, MARKERS[mod]);
  }
  return out;
}
