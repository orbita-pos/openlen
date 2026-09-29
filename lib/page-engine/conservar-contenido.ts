// LO QUE YA ESTABA, LO PONE EL SERVIDOR — también en los cambios de forma.
//
// Tres gestos del taller cambian la ESTRUCTURA de un elemento y dejan dentro lo
// que ya tenía: poner una imagen junto al texto de una sección (su contenido
// pasa a una columna), quitarla (vuelve a salir de la columna) y convertir un
// botón en enlace (sus hijos pasan al `<a>`). Mandaban el elemento nuevo
// entero, leído de la pantalla, y el saneo del fragmento se llevaba de lo de
// dentro los `onclick`, los iframes y el `<script>` que había escrito el modelo.
//
// Es el `Edit` de Claude Code otra vez: se nombra lo que cambia y lo demás sale
// del disco. El fragmento trae el marcado NUEVO —la columna, el `<a>`— y, donde
// va lo que ya estaba, una marca:
//
//   <ol-conservar></ol-conservar>                    el contenido del elemento
//   <ol-conservar data-hijo="1"></ol-conservar>      el de su hijo nº 1 (desde 0)
//
// y aquí la marca se sustituye por esos bytes, sacados del documento GUARDADO.
// El navegador no manda ni un byte de lo que ya estaba.
import { parse } from "node-html-parser";

export const MARCA_CONSERVAR = "ol-conservar";

const MARCA_RE = /<ol-conservar(?:\s+data-hijo="(\d+)")?\s*>\s*<\/ol-conservar>/gi;

export type ResultadoConservar =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly detalle: string };

/** ¿Trae el fragmento alguna marca? */
export function llevaMarcas(fragmento: string): boolean {
  return fragmento.toLowerCase().includes(`<${MARCA_CONSERVAR}`);
}

/**
 * El fragmento con cada marca sustituida por el contenido guardado.
 *
 * `ancla` es el outerHTML GUARDADO del elemento que el fragmento reemplaza;
 * `outerPorId` devuelve el outerHTML guardado de un descendiente por su
 * `data-op-id` (el documento llega etiquetado).
 */
export function conservarContenido(
  fragmento: string,
  ancla: string,
  outerPorId: (opId: string) => string | null,
): ResultadoConservar {
  let fallo: string | null = null;
  const html = fragmento.replace(MARCA_RE, (_marca, hijo: string | undefined) => {
    if (hijo === undefined) return interior(ancla);
    const outer = hijoElemento(ancla, Number(hijo), outerPorId);
    if (outer === null) {
      fallo ??= `el elemento guardado no tiene hijo ${hijo}`;
      return "";
    }
    return interior(outer);
  });
  if (fallo !== null) return { ok: false, detalle: fallo };
  if (llevaMarcas(html)) return { ok: false, detalle: "una marca de conservar sin forma válida" };
  return { ok: true, html };
}

/**
 * Lo que hay entre la etiqueta de apertura y la de cierre, byte a byte.
 *
 * La apertura acaba en el primer `>` que no esté entre comillas (un `alt` puede
 * llevar un `>` dentro); el cierre es el último `</`. Un elemento vacío —o uno
 * sin cierre, como un `<img>`— no tiene interior.
 */
function interior(outer: string): string {
  let comilla: string | null = null;
  let fin = -1;
  for (let i = 0; i < outer.length; i++) {
    const c = outer[i];
    if (comilla) {
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'") {
      comilla = c;
    } else if (c === ">") {
      fin = i + 1;
      break;
    }
  }
  const cierre = outer.lastIndexOf("</");
  if (fin === -1 || cierre < fin) return "";
  return outer.slice(fin, cierre);
}

/** El outerHTML guardado del hijo ELEMENTO nº `k` del ancla, o `null`. */
function hijoElemento(
  ancla: string,
  k: number,
  outerPorId: (opId: string) => string | null,
): string | null {
  const raiz = parse(ancla, { blockTextElements: { script: true, noscript: true, style: true } });
  const elemento = raiz.childNodes.find((n) => n.nodeType === 1);
  if (!elemento) return null;
  const hijos = elemento.childNodes.filter((n) => n.nodeType === 1);
  const hijo = hijos[k] as (typeof hijos)[number] & { getAttribute?: (n: string) => string | undefined };
  const id = hijo?.getAttribute?.("data-op-id");
  return id ? outerPorId(id) : null;
}
