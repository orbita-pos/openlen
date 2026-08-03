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
//     whole; never a partial cut with orphan closers). La huella se compara
//     SIN espacios: una banda que pasó por el DOM del editor vuelve con el
//     style re-serializado por el navegador ("margin: 64px auto;"), y la
//     comparación byte a byte fallaba en silencio → encabezado huérfano sobre
//     un hueco en la página publicada (task-11-browser-report-2).
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

const SECTION_OPEN = "<section";

/** Copia sin espacios en blanco. `buildModuleSection` emite el style compacto
 *  (`max-width:900px;margin:64px auto;`), pero en cuanto la banda pasa por el
 *  DOM del iframe del editor el navegador re-serializa ese style con un espacio
 *  tras cada ":" y ";" (`max-width: 900px; margin: 64px auto;`) — evidencia real
 *  en task-11-browser-evidence-2. Comparar las formas exprimidas reconoce las
 *  dos sin tener que adivinar cuál de los dos formatos trae el documento.
 *  Bucle de un solo paso: lineal, sin regex. */
function squeeze(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r" && ch !== "\f") out += ch;
  }
  return out;
}

// Huella de band(): el style abre con max-width y lleva el margin de la banda.
// Se exige que `max-width` sea la PRIMERA declaración (así la emite band() y así
// la conserva la re-serialización del DOM, que respeta el orden) — dos
// `includes` sueltos sobre el tag entero admitirían la huella repartida entre
// atributos ajenos. El nombre del atributo `style` ya no tiene que ser el
// primero del tag: el editor le añade atributos a la sección.
const BAND_STYLE_HEAD = squeeze('style="max-width:');
const BAND_STYLE_MARGIN = squeeze("margin:64px auto;");

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

    // Enclosing designed band? Nearest <section> opener BEFORE the element, if
    // it carries band()'s style huella and nothing reopens/closes a section in
    // between. ONE candidate, never a rescan: adversarial opener spam degrades
    // to "no band" (marker-only cut), which is the safe direction.
    let removeStart = tagStart;
    let removeEnd = elEnd;
    if (tagName !== "section") {
      const bandOpen = out.lastIndexOf(SECTION_OPEN, tagStart);
      // Frontera del nombre del tag: "<sections…" no es una <section>. Se
      // rechaza en vez de seguir buscando hacia atrás — un bucle de retroceso
      // sobre "<sectionz" repetido sería cuadrático.
      const after = bandOpen === -1 ? "" : out[bandOpen + SECTION_OPEN.length];
      if (bandOpen !== -1 && (after === undefined || after === ">" || after === "/" || after <= " ")) {
        const bandTagEnd = openTagEnd(out, bandOpen);
        const between = out.slice(bandOpen, tagStart);
        const openTag = bandTagEnd === -1 ? "" : out.slice(bandOpen, bandTagEnd + 1);
        const canon = squeeze(openTag);
        if (
          canon.includes(BAND_STYLE_HEAD) &&
          canon.includes(BAND_STYLE_MARGIN) &&
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
