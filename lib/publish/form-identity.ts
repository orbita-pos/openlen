// lib/publish/form-identity.ts — un formulario tiene identidad propia, no un
// número de sitio en la fila.
//
// EL FALLO QUE ESTO CIERRA, medido en la auditoría del 2026-08-21 y el más
// grave de los once: `settings.forms` se resolvía por la POSICIÓN del `<form>`
// en el documento (`formConfigKey`), y el correo de aviso del endpoint de envío
// también. Secuencia real:
//
//   1. El dueño pone `ventas@` en su formulario de contacto → `forms["0"]`.
//   2. Por el Chat pide una sección nueva que trae otro formulario ANTES.
//   3. Ahora el formulario nuevo es el 0 y el de contacto el 1.
//   4. Un cliente escribe por el formulario NUEVO → el endpoint lee `forms["0"]`
//      → **manda el lead a `ventas@`**, que el dueño configuró para otro sitio.
//      Y los del de contacto caen al correo de la cuenta.
//
// En silencio, sin un error, y sobre el dinero de un negocio.
//
// La identidad hay que capturarla CUANDO EL DUEÑO CONFIGURA, no al publicar:
// en publicación el documento y los ajustes son coherentes entre sí, así que
// ningún truco de ahí lo arregla. Por eso el identificador vive en el propio
// documento, se estampa en `preparePage` —el embudo por el que pasa toda
// ingestión y toda edición— y viaja con el formulario a donde lo muevan.
//
// COMPATIBILIDAD. Las claves por índice se siguen leyendo: un proyecto anterior
// a esto conserva su configuración hasta que el backfill (`forms:stamp-ids`) le
// ponga identificadores. El orden de resolución es id → clave con página →
// clave heredada por índice.

import { randomBytes } from "node:crypto";
import { parse, type HTMLElement } from "node-html-parser";

/** El identificador estable, en el propio `<form>`. `data-ol-*` porque el
 *  prompt de rediseño ya ordena conservar intacto todo elemento que lo lleve. */
export const FORM_ID_ATTR = "data-ol-form-id";

/** El campo oculto que lo lleva en el envío. Estático, no inyectado por
 *  JavaScript: un POST sin JS tiene que enrutar igual de bien. */
export const FORM_ID_FIELD = "_openlen_fid";

/** 12 hex. No es un secreto —viaja en el HTML publicado— sólo tiene que ser
 *  único dentro de un proyecto y no decir nada de nadie. */
function nuevoId(): string {
  return `f${randomBytes(6).toString("hex")}`;
}

/**
 * Los identificadores de los `<form>` del documento, EN ORDEN.
 *
 * `""` en la posición de un formulario sin estampar — se conserva el hueco a
 * propósito para que el índice del array siga siendo el índice del documento,
 * que es lo que la ruta heredada necesita.
 */
export function readFormIds(html: string): string[] {
  if (!html.includes("<form")) return [];
  try {
    return parse(html)
      .querySelectorAll("form")
      .map((f) => f.getAttribute(FORM_ID_ATTR)?.trim() ?? "");
  } catch {
    return [];
  }
}

export interface StampResult {
  readonly html: string;
  /** Todos los identificadores en orden, ya estampados. */
  readonly ids: string[];
  /** Cuántos se han creado AHORA. 0 ⇒ el html sale byte a byte igual. */
  readonly stamped: number;
}

/** `[desde, hasta)` del html original se sustituye por `texto`. */
interface Empalme {
  readonly desde: number;
  readonly hasta: number;
  readonly texto: string;
}

// La gramática con la que el parser lee los atributos (`rawAttributes` en
// node-html-parser), copiada tal cual: localizar el atributo con OTRA podría
// tocar uno distinto del que después lee `readFormIds`.
const ATRIBUTO = /([a-zA-Z()[\]#@$.?:][a-zA-Z0-9-._:()[\]#]*)(?:\s*=\s*((?:'[^']*')|(?:"[^"]*")|\S+))?/g;

/**
 * Dónde poner `id` en la etiqueta de apertura de `form`, sobre el texto
 * ORIGINAL. El parser da la posición de origen del `<` (`range[0]`) y los
 * atributos sin tocar (`rawAttrs`, que empieza tras UN blanco).
 *
 * Si la etiqueta ya trae el atributo (vacío o duplicado), se sustituye ESE —
 * el primero, que es el que leen tanto el navegador como el parser cuando no
 * está vacío. Si no, se inserta justo tras el nombre de la etiqueta: ahí no
 * puede cambiar cómo se lee ningún otro atributo, ni con valores sin comillas
 * ni con un `/>` al final.
 */
function empalmeDelId(html: string, form: HTMLElement, id: string): Empalme {
  const trasNombre = form.range[0] + 1 + form.rawTagName.length;
  const desdeAtributos = trasNombre + 1;
  if (
    html.slice(form.range[0], trasNombre) !== `<${form.rawTagName}` ||
    (form.rawAttrs !== "" && !html.startsWith(form.rawAttrs, desdeAtributos))
  ) {
    // No debería pasar nunca — el parser no retoca las etiquetas que lee. Si
    // pasa, mejor fallar que estampar a ciegas: `preparePage` lo registra y
    // el formulario sigue por la ruta heredada por índice.
    throw new Error(`stampFormIds: la etiqueta <${form.rawTagName}> no está donde dice el parser`);
  }
  const atributo = `${FORM_ID_ATTR}="${id}"`;
  for (const m of form.rawAttrs.matchAll(ATRIBUTO)) {
    if (m[1]!.toLowerCase() !== FORM_ID_ATTR) continue;
    const desde = desdeAtributos + m.index!;
    return { desde, hasta: desde + m[0].length, texto: atributo };
  }
  return { desde: trasNombre, hasta: trasNombre, texto: ` ${atributo}` };
}

/**
 * Da identidad a los formularios que no la tengan. Idempotente.
 *
 * NUNCA `dom.toString()`: el round-trip del parser no es identidad (pierde
 * comentarios, normaliza `/>`, re-entrecomilla los atributos) y el código de la
 * página es el que escribió el modelo, no el que el parser sabe reescribir. Se
 * empalma el atributo en el texto original y ningún otro byte cambia; con 0
 * estampados sale el mismo string.
 */
export function stampFormIds(html: string): StampResult {
  if (!html.includes("<form")) return { html, ids: [], stamped: 0 };
  let dom;
  try {
    dom = parse(html);
  } catch {
    return { html, ids: [], stamped: 0 };
  }
  const forms = dom.querySelectorAll("form");
  if (forms.length === 0) return { html, ids: [], stamped: 0 };

  const vistos = new Set<string>();
  const ids: string[] = [];
  const empalmes: Empalme[] = [];
  for (const f of forms) {
    const actual = f.getAttribute(FORM_ID_ATTR)?.trim() ?? "";
    // Un duplicado se re-estampa: dos formularios con el mismo id resolverían
    // la misma configuración, que es exactamente el fallo que esto cierra. Pasa
    // de verdad — el modelo copia una sección entera, atributos incluidos.
    if (actual !== "" && !vistos.has(actual)) {
      vistos.add(actual);
      ids.push(actual);
      continue;
    }
    let id = nuevoId();
    while (vistos.has(id)) id = nuevoId();
    empalmes.push(empalmeDelId(html, f, id));
    vistos.add(id);
    ids.push(id);
  }

  if (empalmes.length === 0) return { html, ids, stamped: 0 };
  // Cada formulario tiene su propia etiqueta de apertura, así que los empalmes
  // no se solapan; basta coserlos en orden de documento.
  empalmes.sort((a, b) => a.desde - b.desde);
  let out = "";
  let cursor = 0;
  for (const e of empalmes) {
    out += html.slice(cursor, e.desde) + e.texto;
    cursor = e.hasta;
  }
  return { html: out + html.slice(cursor), ids, stamped: empalmes.length };
}

/**
 * La configuración que le toca a cada formulario, por POSICIÓN en el documento.
 *
 * Es la única función que sabe el orden de resolución, y la comparten el
 * cableado de publicación y el endpoint de envío para que no puedan divergir:
 * si publicar y recibir resolvieran distinto, el lead volvería a irse a otro
 * sitio y esta vez sin que ningún índice lo explicara.
 *
 * @param ids identificadores en orden de documento (`readFormIds`)
 * @param page slug de la subpágina, o null para el inicio
 */
export function resolveFormConfigKey(
  ids: readonly string[],
  index: number,
  page: string | null | undefined,
  configs: Readonly<Record<string, unknown>>,
): string | null {
  const id = ids[index]?.trim();
  // 1. Identidad propia. Gana siempre: es lo único que sobrevive a que muevan
  //    el formulario de sitio.
  if (id && Object.prototype.hasOwnProperty.call(configs, id)) return id;
  // 2. Clave con página, de la época multi-página.
  if (page) {
    const scoped = `${page}:${index}`;
    if (Object.prototype.hasOwnProperty.call(configs, scoped)) return scoped;
  }
  // 3. Clave heredada por índice. Sigue viva hasta que el backfill estampe.
  const legacy = String(index);
  if (Object.prototype.hasOwnProperty.call(configs, legacy)) return legacy;
  return null;
}
