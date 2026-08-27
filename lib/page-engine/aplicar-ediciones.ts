// EL EDITOR GUARDA EDICIONES, NO FOTOS DEL DOM.
//
// EL PROBLEMA. Los cinco inyectores del taller guardaban clonando el documento
// VIVO entero (`captureClean` en use-inline-edit.ts) y mandándolo como la
// página del usuario. Con el JavaScript del modelo corriendo, todo lo que el
// script hubiera hecho se persistía: filtras a «Blackwork», editas el titular,
// y tu página queda filtrada para siempre. Por eso el taller CONGELA el
// JavaScript mientras editas — y por eso Jesús vio su página muerta y pensó que
// estaba rota (2026-08-26).
//
// LA SOLUCIÓN, que es la de v0. Design Mode «runs against the live preview of
// your project»: el JavaScript no se pausa. Los cambios son *pending edits*, y
// al aplicar, v0 «serializes your edits … and generates an updated version of
// your project that reflects the changes in your source code». Serializa LAS
// EDICIONES, no el DOM. Mientras editas no se guarda nada, así que da igual lo
// que el script haya hecho en pantalla.
//
// Esto NO es prohibir. La prohibición vieja era «el modelo no puede escribir
// JavaScript»; ésta es «no leemos tu página de vuelta desde la pantalla».
// Guardar ediciones es justo lo que PERMITE que el JS corra siempre.
//
// EL PROTOCOLO YA EXISTÍA. El gesto «elige un elemento» del Chat lleva desde F1
// mandando una ruta posicional desde el iframe y resolviéndola contra el
// documento guardado (app/api/agent/route.ts:317). Esto es el mismo viaje, para
// las ediciones del taller.

import { applyOps, resolveOpIdByPath, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { sanitizeForPublish } from "@/lib/html-engine";
import { applyHeadOp } from "@/lib/ai-stream/document-ops";

/** Las cuatro operaciones que el motor de ops sabe hacer, que resultan ser
 *  exactamente las que el taller necesita: escribir un texto o cambiar unos
 *  atributos es `replace`; insertar una sección es `insert_*`; mover una es
 *  `delete` + `insert_*`; borrarla es `delete`. */
export type OpDeEdicion =
  | "replace"
  | "insert_before"
  | "insert_after"
  | "delete"
  /** Atributos del elemento raíz `<html>` — ver `AtributosRaiz`. */
  | "attrs_raiz"
  /** Nodos para el `<head>` — ver `NodosCabeza`. */
  | "cabeza";

/**
 * ATRIBUTOS DEL ELEMENTO RAÍZ.
 *
 * El selector de tema del inspector no cambia un elemento del cuerpo: escribe
 * en `<html>` — su `style` inline (los tokens `--ol-*`) y su `data-ol-mode`
 * (claro/oscuro). Es UN elemento, sólo que fuera del `<body>`, así que no tiene
 * ruta posicional y no se puede nombrar como los demás.
 *
 * Sólo se tocan los atributos NOMBRADOS. Los que no vengan en la lista se
 * quedan como estaban: `lang`, la clase que el normalizador puso, lo que sea.
 * Mandar el conjunto entero convertiría un cambio de acento en una reescritura
 * de la raíz.
 */
export interface AtributosRaiz {
  readonly op: "attrs_raiz";
  /** Nombre → valor. `null` QUITA el atributo. */
  readonly attrs: Readonly<Record<string, string | null>>;
}

/**
 * NODOS PARA EL `<head>`.
 *
 * El título, la descripción, la hoja de fuentes de Google, el `<style>` de una
 * temática. Se apoya en `applyHeadOp`, que ya resuelve lo delicado: un `<title>`
 * o una `<meta name>` REEMPLAZAN al que hubiera —dos títulos no son un añadido,
 * son un documento roto del que el navegador elige uno— y un `<link href>` que
 * ya está no se repite.
 */
export interface NodosCabeza {
  readonly op: "cabeza";
  /** Los nodos, en serie. Se sanean como cualquier fragmento del navegador.
   *  Vacío con `reemplazarPorAtributo` = sólo quitar. */
  readonly html: string;
  /**
   * Quita antes los nodos de la cabeza que lleven ESTE atributo.
   *
   * Hace falta para lo que se SUSTITUYE en vez de acumularse: la hoja de
   * fuentes (`data-ol-fonts`) y la de una temática (`data-ol-tematica`).
   * `applyHeadOp` sólo reemplaza `<title>` y `<meta name>` — un `<link>` cuyo
   * href cambia se añadiría al lado del anterior, y la página acabaría
   * cargando las dos tipografías y pintando la primera.
   *
   * Admite `nombre=valor` para acotar: `property=og:image` toca la etiqueta de
   * la imagen social y deja en paz al resto de `<meta property>`. Sin el valor,
   * `property` se llevaría todas por delante.
   *
   * Con `html` vacío, sólo quita — que es como se BORRA una descripción o un
   * favicon.
   */
  readonly reemplazarPorAtributo?: string;
}

export interface EdicionDeElemento {
  readonly op: "replace" | "insert_before" | "insert_after" | "delete";
  /** Ruta posicional del elemento ANCLA, construida en el iframe
   *  (`section:nth-of-type(3) > div:nth-of-type(2) > h1:nth-of-type(1)`). */
  readonly path: string;
  /** El nombre de etiqueta que el iframe vio, en minúsculas. Primera barrera:
   *  si la ruta resuelve a otra cosa, no se toca nada. */
  readonly tag: string;
  /** Las etiquetas de los hijos directos, en orden, tal y como el iframe las
   *  vio. Ver `firmaEstructural`. */
  readonly hijos: readonly string[];
  /** El outerHTML del elemento, o el fragmento a insertar. Ausente en
   *  `delete`. */
  readonly html?: string;
}

export type Edicion = EdicionDeElemento | AtributosRaiz | NodosCabeza;

export type MotivoRechazo =
  /** La ruta no encuentra ningún elemento en el documento guardado. */
  | "ruta_no_resuelve"
  /** Resuelve, pero a un elemento que no es el que el usuario tocó. */
  | "otro_elemento"
  /** El fragmento que llegó del navegador trae algo que no puede persistirse. */
  | "fragmento_rechazado"
  /** Falta el `html` en una operación que lo necesita. */
  | "sin_fragmento"
  /** El motor de ops no pudo aplicarla. */
  | "op_fallo"
  /** El documento no tiene `<html>` — no debería pasar nunca. */
  | "sin_raiz";

export type ResultadoEdiciones =
  | { readonly ok: true; readonly html: string; readonly aplicadas: number }
  | {
      readonly ok: false;
      readonly motivo: MotivoRechazo;
      /** Índice de la edición que falló, para poder decir CUÁL. */
      readonly indice: number;
      readonly detalle: string;
    };

/**
 * Las etiquetas de los hijos directos de un elemento, en orden.
 *
 * ES LA SEGUNDA BARRERA, y hace falta porque la ruta es POSICIONAL. Si el
 * script del modelo insertó o quitó hermanos del mismo tipo, los índices
 * `nth-of-type` del DOM vivo dejan de casar con los del documento guardado y la
 * ruta resolvería a un elemento vecino — que es la forma en que una edición
 * puede aterrizar callada en el sitio equivocado.
 *
 * Los hijos directos son una firma barata que sobrevive a lo que los scripts
 * hacen de verdad (poner y quitar clases, cambiar estilos, escribir texto) y
 * cambia justo cuando la estructura se ha movido debajo.
 *
 * No es infalible —dos hermanos gemelos tienen la misma firma— y por eso lo que
 * se hace al fallar es RECHAZAR EL LOTE ENTERO, nunca aplicar a medias.
 */
function firmaEstructural(html: string): string[] {
  const out: string[] = [];
  // Se lee el nivel SUPERIOR del fragmento: el primer elemento es el propio
  // ancla; sus hijos directos son lo que se compara.
  const interior = html.replace(/^\s*<[^>]*>/, "").replace(/<\/[a-zA-Z][^>]*>\s*$/, "");
  let profundidad = 0;
  const etiqueta = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = etiqueta.exec(interior)) !== null) {
    const cierra = m[1] === "/";
    const nombre = m[2]!.toLowerCase();
    const autocierra = m[3] === "/" || VACIOS.has(nombre);
    if (cierra) {
      profundidad = Math.max(0, profundidad - 1);
      continue;
    }
    if (profundidad === 0) out.push(nombre);
    if (!autocierra) profundidad += 1;
  }
  return out;
}

/** Elementos HTML sin etiqueta de cierre. Sin esta lista un `<img>` suelto
 *  dejaría la profundidad desbalanceada y la firma entera saldría mal. */
const VACIOS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** El elemento que `opId` señala, tal y como está en el documento etiquetado. */
function elementoDe(taggedHtml: string, opId: string): string | null {
  // Se busca la etiqueta de apertura que lleva ese id y se recorta desde ahí
  // hasta su cierre, contando anidamiento del mismo tag.
  const abre = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\bdata-op-id="${opId}"[^>]*>`,
  );
  const m = abre.exec(taggedHtml);
  if (!m) return null;
  const tag = m[1]!.toLowerCase();
  const inicio = m.index;
  if (VACIOS.has(tag)) return taggedHtml.slice(inicio, inicio + m[0].length);
  const cursor = new RegExp(`<(/?)${tag}\\b[^>]*?>`, "gi");
  cursor.lastIndex = inicio + m[0].length;
  let nivel = 1;
  let paso: RegExpExecArray | null;
  while ((paso = cursor.exec(taggedHtml)) !== null) {
    nivel += paso[1] === "/" ? -1 : 1;
    if (nivel === 0) return taggedHtml.slice(inicio, paso.index + paso[0].length);
  }
  return null;
}

/**
 * Quita de la cabeza los nodos que lleven un atributo.
 *
 * Sobre la cadena y sólo dentro del `<head>`: un `data-ol-fonts` en el cuerpo
 * —que no debería existir, pero el documento es del usuario— no es asunto de
 * esta operación.
 */
function quitarDeCabezaPorAtributo(html: string, spec: string): string {
  const corte = spec.indexOf("=");
  const attr = corte === -1 ? spec : spec.slice(0, corte);
  const valorPedido = corte === -1 ? null : spec.slice(corte + 1);
  if (!/^[a-zA-Z_:][\w:.-]*$/.test(attr)) return html;
  if (valorPedido !== null && /["'<>]/.test(valorPedido)) return html;
  const m = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  if (!m) return html;
  const dentro = m[1] ?? "";
  // Sin valor pedido: el atributo con lo que sea, o sin nada — así
  // `data-ol-fonts` casa esté suelto o con valor. Con valor pedido: sólo ése,
  // entre comillas de cualquier tipo o sin ellas.
  const escapado = (valorPedido ?? "").replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  const valor =
    valorPedido === null
      ? `(=("[^"]*"|'[^']*'|[^\\s>]*))?`
      : `=("${escapado}"|'${escapado}'|${escapado})(?=[\\s>])`;
  // Con cierre (`<style …>…</style>`) y vacíos (`<link …>`), en ese orden:
  // el segundo patrón casaría la apertura del primero.
  const conCierre = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*\\s${attr}${valor}[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "gi",
  );
  const vacio = new RegExp(
    `<[a-zA-Z][\\w-]*\\b[^>]*\\s${attr}${valor}[^>]*/?>`,
    "gi",
  );
  const limpio = dentro.replace(conCierre, "").replace(vacio, "");
  return limpio === dentro
    ? html
    : html.slice(0, m.index) +
        m[0].replace(dentro, limpio) +
        html.slice(m.index + m[0].length);
}

/**
 * Reescribe la etiqueta de apertura de `<html>` con los atributos nombrados.
 *
 * A mano y sobre la cadena, no con un parser: pasar el documento entero por
 * DOMParser para cambiar un atributo lo normalizaría de arriba abajo —
 * comillas, orden de atributos, entidades— y eso es reescribir la página del
 * usuario para cambiarle el color de acento.
 */
function aplicarAtributosRaiz(
  html: string,
  attrs: Readonly<Record<string, string | null>>,
): string | null {
  const m = /<html\b([^>]*)>/i.exec(html);
  if (!m) return null;
  let cabecera = m[1] ?? "";
  for (const [nombre, valor] of Object.entries(attrs)) {
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(nombre)) continue;
    const re = new RegExp(`\\s${nombre}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
    cabecera = cabecera.replace(re, "");
    if (valor !== null && valor !== "") {
      cabecera += ` ${nombre}="${valor.replace(/"/g, "&quot;")}"`;
    }
  }
  return html.slice(0, m.index) + `<html${cabecera}>` + html.slice(m.index + m[0].length);
}

/** El nombre de etiqueta de un fragmento, en minúsculas. */
function tagDe(html: string): string {
  return /^\s*<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html)?.[1]?.toLowerCase() ?? "";
}

/**
 * Aplica las ediciones del taller sobre el documento GUARDADO, en orden.
 *
 * Se re-estampa entre ediciones a propósito: si la primera reordena secciones y
 * la segunda toca un elemento cuyo índice cambió por culpa de la primera, la
 * segunda se resuelve contra el documento YA REORDENADO — que es exactamente el
 * que el usuario tenía delante cuando la hizo.
 *
 * TODO O NADA. Un rechazo devuelve el motivo y el índice, y el llamador deja el
 * documento como estaba. Aplicar «las que se pudieron» dejaría al usuario con
 * media edición y sin forma de saber cuál falta, que es peor que no guardar.
 */
export function aplicarEdiciones(
  documento: string,
  ediciones: readonly Edicion[],
): ResultadoEdiciones {
  let actual = documento;

  for (let i = 0; i < ediciones.length; i++) {
    const e = ediciones[i]!;

    if (e.op === "attrs_raiz") {
      const r = aplicarAtributosRaiz(actual, e.attrs);
      if (r === null) {
        return { ok: false, motivo: "sin_raiz", indice: i, detalle: "no hay <html>" };
      }
      actual = r;
      continue;
    }

    if (e.op === "cabeza") {
      const limpio = sanitizeForPublish(
        // `applyHeadOp` trabaja sobre un documento; el saneador también. Se
        // envuelven los nodos para que los dos vean lo que esperan.
        "<!doctype html><html><head>" + e.html + "</head><body></body></html>",
      );
      if (limpio.html === null) {
        return {
          ok: false,
          motivo: "fragmento_rechazado",
          indice: i,
          detalle: limpio.errors.join("; "),
        };
      }
      const dentro = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(limpio.html)?.[1] ?? "";
      if (e.reemplazarPorAtributo) {
        actual = quitarDeCabezaPorAtributo(actual, e.reemplazarPorAtributo);
      }
      if (dentro.trim()) actual = applyHeadOp(actual, { kind: "nodos", html: dentro });
      continue;
    }

    const necesitaHtml = e.op !== "delete";
    if (necesitaHtml && !e.html) {
      return { ok: false, motivo: "sin_fragmento", indice: i, detalle: e.op };
    }

    // EL FRAGMENTO VIENE DEL NAVEGADOR. Se sanea sin excepción — es la misma
    // regla que la ruta de guardado de siempre. Un `<script>` en el fragmento
    // sería código que el usuario (o quien le mande un PATCH) mete en su
    // propia página publicada bajo un subdominio nuestro.
    let fragmento = e.html ?? "";
    if (necesitaHtml) {
      const limpio = sanitizeForPublish(fragmento);
      if (limpio.html === null) {
        return {
          ok: false,
          motivo: "fragmento_rechazado",
          indice: i,
          detalle: limpio.errors.join("; "),
        };
      }
      fragmento = limpio.html;
    }

    const { taggedHtml } = tagWithOpIds(actual);
    const opId = resolveOpIdByPath(taggedHtml, e.path);
    if (!opId) {
      return { ok: false, motivo: "ruta_no_resuelve", indice: i, detalle: e.path };
    }

    const ancla = elementoDe(taggedHtml, opId);
    if (!ancla) {
      return { ok: false, motivo: "ruta_no_resuelve", indice: i, detalle: opId };
    }
    if (tagDe(ancla) !== e.tag.toLowerCase()) {
      return {
        ok: false,
        motivo: "otro_elemento",
        indice: i,
        detalle: `esperaba <${e.tag}> y la ruta lleva a <${tagDe(ancla)}>`,
      };
    }
    const firma = firmaEstructural(ancla);
    if (firma.join(",") !== e.hijos.join(",")) {
      return {
        ok: false,
        motivo: "otro_elemento",
        indice: i,
        detalle: `la estructura no coincide: [${e.hijos.join(",")}] vs [${firma.join(",")}]`,
      };
    }

    const r = applyOps(taggedHtml, [
      { type: e.op, target: opId, ...(necesitaHtml ? { newHtml: fragmento } : {}) },
    ]);
    if (r.html === null || r.appliedCount === 0) {
      return {
        ok: false,
        motivo: "op_fallo",
        indice: i,
        detalle: r.errors.map((x) => x.reason).join("; ") || "sin efecto",
      };
    }
    actual = stripOpIds(r.html);
  }

  return { ok: true, html: actual, aplicadas: ediciones.length };
}
