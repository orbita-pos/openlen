// Tokenizador de atributos compartido: decidir «¿este tag lleva REALMENTE este
// atributo?» sobre HTML arbitrario, sin DOM y en tiempo lineal.
//
// Un solo hogar a propósito. Las tres superficies que se hacen la misma
// pregunta — stripBandByMarker al publicar, fillPlatformsBand al sembrar y el
// preview del canvas — nacieron con copias byte a byte del mismo escáner, así
// que el próximo arreglo se habría aplicado a una sola.
//
// PURO: sin `node:`, sin BD, sin DOM. components/workspace-v2 lo importa desde
// el cliente.
//
// Escaneo lineal en todo — nada de regex temperadas/perezosas sobre el
// documento: la primera versión de stripBandByMarker medía O(n²) con pegados
// de 8MB y colgaba el event loop al publicar.

/** Índice del ">" que cierra el tag que empieza en `open`, saltando cualquier
 *  ">" que aparezca dentro del valor entrecomillado de un atributo. -1 si el
 *  tag nunca cierra. */
export function openTagEnd(html: string, open: number): number {
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

/** ¿`name` es un atributo GENUINO de `tagText` — y no una subcadena que resulta
 *  vivir dentro del valor entrecomillado de otro atributo (p.ej.
 *  title="ver data-ol-platforms-section docs")? Camina TOKENS de atributo en
 *  vez de hacer una búsqueda de subcadena. */
export function hasAttr(tagText: string, name: string): boolean {
  ATTR_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_TOKEN_RE.exec(tagText))) {
    if (m[1] === name) return true;
    if (m.index === ATTR_TOKEN_RE.lastIndex) ATTR_TOKEN_RE.lastIndex++;
  }
  return false;
}

export interface MarkerTag {
  /** Nombre del tag en minúsculas — "section" o "div". */
  tag: string;
  /** Índice del "<" que abre el elemento. */
  start: number;
  /** Índice justo DESPUÉS del ">" del tag de apertura: donde empieza su
   *  contenido, y donde un inyector debe escribir. */
  contentStart: number;
}

// Repeticiones adversarias del texto del marcador no pueden hacer girar el
// escáner: mismo tope que ya usaban las dos copias originales.
const SCAN_GUARD = 200;

/** Cada <section|div> que lleva `marker` como atributo de verdad, en orden de
 *  documento. Salta los falsos positivos (el texto del marcador dentro del
 *  valor de otro atributo) en vez de detenerse en ellos. */
export function findMarkerTags(html: string, marker: string): MarkerTag[] {
  const hits: MarkerTag[] = [];
  let from = 0;
  for (let guard = 0; guard < SCAN_GUARD; guard++) {
    const idx = html.indexOf(marker, from);
    if (idx === -1) break;
    const start = html.lastIndexOf("<", idx);
    if (start === -1) {
      from = idx + marker.length;
      continue;
    }
    const tagMatch = /^<(section|div)\b/i.exec(html.slice(start, start + 9));
    if (!tagMatch) {
      from = idx + marker.length;
      continue;
    }
    const tagEnd = openTagEnd(html, start);
    if (tagEnd === -1) {
      from = idx + marker.length;
      continue;
    }
    if (hasAttr(html.slice(start, tagEnd), marker)) {
      hits.push({ tag: tagMatch[1].toLowerCase(), start, contentStart: tagEnd + 1 });
    }
    from = tagEnd + 1;
  }
  return hits;
}

/** El primer elemento que lleva `marker` de verdad, o null. */
export function findMarkerTag(html: string, marker: string): MarkerTag | null {
  return findMarkerTags(html, marker)[0] ?? null;
}
