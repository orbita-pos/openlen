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

import { BAND_ATTR, BAND_ATTR_OPEN, hasAttr, openTagEnd } from "./tag-attrs";
import { ITEM_ATTR } from "./collection-template";

// ESTA LISTA INCLUYE MÓDULOS MUERTOS A PROPÓSITO, y es lo contrario de una
// lista desactualizada: el trabajo de este fichero es borrar la banda de un
// módulo apagado, y un módulo RETIRADO está apagado para siempre. Sin su
// marcador aquí, una página ya publicada que heredó esa banda se queda con un
// hueco vacío y su titular encima — para siempre.
//
// No confundir con `ModuleSurface` (module-sections.ts), que es lo que se puede
// INSERTAR hoy: sólo `chat`.
const MARKERS = {
  bookings: "data-ol-bookings-section",
  collections: "data-ol-collection-section",
  comments: "data-ol-comments-section",
  chat: "data-ol-chat-section",
  // Su banda murió el 2026-08-29; entra aquí para que las heredadas se limpien.
  platforms: "data-ol-platforms-section",
} as const;

export type StrippableModule = keyof typeof MARKERS;

const BAND_OPEN_PREFIX = '<section style="max-width:';
/** Huella de RESPALDO, solo para bandas insertadas antes de que se estampara el
 *  envoltorio. Exige la firma COMPLETA que `band()` emite desde su primera
 *  versión (63a95c39, 2026-06-25), no un par de tokens: bastando
 *  `margin:64px auto`, una `<section>` centrada del usuario que contuviera un
 *  marcador se borraba entera. Exigir las cuatro no pierde ninguna banda vieja
 *  —todas salieron de esa misma función— y solo puede fallar hacia «no la
 *  detecto», nunca hacia borrar contenido ajeno. */
const BAND_OPEN_SIGNATURE = [
  "margin:64px auto;",
  "padding:0 24px;",
  "box-sizing:border-box;",
];

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
      // Ancla por ATRIBUTO primero: exacta, imposible de confundir con una
      // sección del usuario. Si el documento trae una banda VIEJA (insertada
      // antes de que se estampara), caemos a la huella de estilo, que ahora
      // exige la firma completa. Una banda vieja ya normalizada por el DOM del
      // editor sigue sin detectarse: es el estado actual, y cubrirla exigiría
      // ensanchar la huella — el camino que ya borró secciones de más.
      let bandOpen = out.lastIndexOf(BAND_ATTR_OPEN, tagStart);
      let stamped = bandOpen !== -1;
      if (!stamped) bandOpen = out.lastIndexOf(BAND_OPEN_PREFIX, tagStart);
      if (bandOpen !== -1) {
        const bandTagEnd = out.indexOf(">", bandOpen);
        const between = out.slice(bandOpen, tagStart);
        const openTag = bandTagEnd === -1 ? "" : out.slice(bandOpen, bandTagEnd + 1);
        if (stamped) stamped = hasAttr(openTag, BAND_ATTR);
        if (
          (stamped || BAND_OPEN_SIGNATURE.every((t) => openTag.includes(t))) &&
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

export interface StripBandsResult {
  html: string;
  /** Los módulos cuya banda se cortó DE VERDAD en esta pasada — no los que se
   *  miraron. Vacío es el caso normal y no significa nada.
   *
   *  Existe porque esta limpieza era MUDA: se llevaba una sección entera del
   *  documento publicado y el dueño no se enteraba. Publicaba, veía su página
   *  sin la sección, y no tenía forma de saber si la había borrado él, si la IA
   *  se la había comido o si el sitio estaba roto. La doctrina de degradación
   *  pide justo lo contrario — cuando la página deja de hacer lo que decía, se
   *  DICE. Quien lo cuenta es `publishProject`; aquí sólo se levanta acta. */
  removed: StrippableModule[];
}

/** Remove the bands of every module flagged OFF. Flags mirror the publish
 *  ctx gates: `false` = module disabled → its band must not ship. */
export function stripDisabledModuleBands(
  html: string,
  enabled: Record<StrippableModule, boolean>,
): StripBandsResult {
  let out = html;
  const removed: StrippableModule[] = [];
  for (const mod of Object.keys(MARKERS) as StrippableModule[]) {
    if (enabled[mod]) continue;
    if (!out.includes(MARKERS[mod])) continue;
    // Colecciones con tarjetas del MODELO no se borra nunca. Esta limpieza
    // nació cuando la banda era un hueco vacío: apagar el módulo dejaba un
    // título sobre la nada, así que fuera. Desde `collection-template.ts` la
    // banda la escribe el modelo — es una sección diseñada, con su copy y su
    // maquetación — y borrarla al apagar el módulo le arrancaría al usuario
    // parte de su página. Apagado ahora significa «no la refresques desde la
    // base», no «bórrala».
    if (mod === "collections" && out.includes(ITEM_ATTR)) continue;
    // Se compara el ANTES con el DESPUÉS en vez de fiarse de que el marcador
    // estuviera: `stripBandByMarker` puede no encontrar el cierre y devolver el
    // documento intacto. Levantar acta de un corte que no ocurrió avisaría al
    // dueño de una pérdida que no ha tenido — y un aviso falso gasta la
    // confianza que este aviso existe para ganar.
    const antes = out;
    out = stripBandByMarker(out, MARKERS[mod]);
    if (out !== antes) removed.push(mod);
  }
  return { html: out, removed };
}
