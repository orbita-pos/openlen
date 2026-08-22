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
import { parse } from "node-html-parser";

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

/**
 * Da identidad a los formularios que no la tengan. Idempotente.
 *
 * Con 0 estampados devuelve el html ORIGINAL, jamás `dom.toString()`: el
 * round-trip del parser no es identidad (pierde comentarios, normaliza `/>`) y
 * una página no debe degradarse por pasar por aquí sin trabajo que hacer.
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
  let stamped = 0;
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
    f.setAttribute(FORM_ID_ATTR, id);
    vistos.add(id);
    ids.push(id);
    stamped++;
  }

  if (stamped === 0) return { html, ids, stamped: 0 };
  return { html: dom.toString(), ids, stamped };
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
