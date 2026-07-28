// Detecta copy de la PLANTILLA que sobrevivió al relleno.
//
// El relleno (lib/assemble/fill-gemini) etiqueta cada elemento y deja que el
// modelo elija cuáles reescribir. Su único guardián mide "de las ops que
// emití, ¿cuántas aplicaron?" — nunca "¿cubrí la página?". Un modelo que emite
// cinco ops y aplica las cinco marca 100% de éxito con el resto de la página
// todavía hablando del negocio anterior. Casos reales medidos: una página de
// inmobiliaria con el encabezado "¿Por qué MORADA?" y párrafos enteros de la
// agencia de la plantilla; una tienda gamer con "© VITRINA · Punto de venta".
//
// Aquí no se adivina: un bloque solo cuenta como fuga si es IDÉNTICO en las dos
// versiones. Eso vuelve seguro marcar marcas que además son palabras comunes
// (morada, senda, aldea) — una frase nueva que casualmente diga "morada" no
// coincide con la frase de la plantilla.

/** Un bloque es "sustantivo" a partir de aquí: por debajo suelen ser etiquetas
 *  genéricas ("Producto", "Hablemos") que se repiten con toda legitimidad. */
const SUBSTANTIVE_CHARS = 30;

const LEAF_TEXT =
  /<(?:p|h1|h2|h3|h4|h5|li|span|a|button|td|th|div|dt|dd|figcaption|blockquote|strong|em|small)\b[^>]*>([^<]{8,})</gi;

/** Texto visible, por bloque, en minúsculas y con espacios colapsados. */
export function visibleTextBlocks(html: string): Set<string> {
  const bodyAt = html.search(/<body[^>]*>/i);
  const body = bodyAt === -1 ? html : html.slice(bodyAt);
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const out = new Set<string>();
  let m: RegExpExecArray | null;
  LEAF_TEXT.lastIndex = 0;
  while ((m = LEAF_TEXT.exec(stripped)) !== null) {
    const t = m[1]
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length >= 8 && /[a-záéíóúüñ]{3}/i.test(t)) out.add(t.toLowerCase());
  }
  return out;
}

/** La marca de la plantilla: la primera palabra "de nombre" de su <title>. */
export function brandToken(html: string): string | null {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!t) return null;
  const first = t
    .replace(/&[a-z#0-9]+;/gi, " ")
    .split(/[\s·—–|,:]+/)
    .map((w) => w.trim())
    .find((w) => w.length >= 4 && /^[a-záéíóúüñ]+$/i.test(w));
  return first ? first.toLowerCase() : null;
}

export interface LeakReport {
  /** Bloques idénticos en plantilla y resultado. */
  shared: string[];
  /** Los que de verdad hacen daño: copy sustantivo, o que nombra la plantilla. */
  damaging: string[];
}

export function detectTemplateLeaks(
  sourceHtml: string,
  filledHtml: string,
): LeakReport {
  const src = visibleTextBlocks(sourceHtml);
  const out = visibleTextBlocks(filledHtml);
  const brand = brandToken(sourceHtml);

  const shared: string[] = [];
  const damaging: string[] = [];
  for (const block of out) {
    if (!src.has(block)) continue;
    shared.push(block);
    if (block.length >= SUBSTANTIVE_CHARS || (brand && block.includes(brand))) {
      damaging.push(block);
    }
  }
  return { shared, damaging };
}
