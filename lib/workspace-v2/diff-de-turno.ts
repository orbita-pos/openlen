// QUÉ SECCIONES CAMBIÓ ESTE TURNO — el diff que el usuario puede mirar.
//
// POR QUÉ EXISTE. Auditada la superficie del Chat: cuando Len termina un turno,
// el lienzo se REPINTA ENTERO y se le restaura el scroll, así que si el cambio
// queda fuera de pantalla la pantalla es idéntica y no hay ninguna señal. El
// único efecto visual es el barrido «Rayo X», que es de página completa y sale
// igual se haya tocado un punto o todo. No había ni resalte, ni scroll a lo
// tocado, ni antes/después.
//
// EL PAR YA ESTABA EN EL CLIENTE: `preEditHtml` (snapshot al enviar) y
// `postEditHtml` (del evento `html`) se guardan para Deshacer y no se usaban
// para nada más. Esto es lo que faltaba entre los dos.
//
// LO QUE ESTO NO ES, y conviene decirlo antes de que alguien se apoye de más:
// un diff de HTML ADIVINA la intención en vez de saberla. Una sección movida
// sale como «sin cambios» y una renombrada sale como una quitada más una
// añadida. Saber de verdad QUÉ se cambió exige propagar las ops que hoy mueren
// en `lib/agent/tools.ts` — eso es otra cosa, más cara, y no es esto.
//
// Corre en el navegador y usa `DOMParser`, que es nativo: cero coste de bundle
// y disponible también en jsdom, así que su prueba no mockea nada.

export type TipoDeCambio = "anadida" | "quitada" | "cambiada";

export interface SeccionCambiada {
  readonly tipo: TipoDeCambio;
  /** Lo que el usuario lee. Sale del encabezado de la sección, de su `id` o,
   *  en último caso, de su etiqueta HTML. */
  readonly etiqueta: string;
  /** Posición entre los hijos de `<body>` en el documento DESPUÉS — es lo que
   *  se le manda al lienzo para ir a ella. `-1` en las quitadas: ya no están
   *  ahí, así que no hay nada a lo que ir. */
  readonly indice: number;
}

/** Más de esto es una lista que el usuario hojea en vez de leer, y un rediseño
 *  entero produciría cuarenta filas dentro de un panel de 380px. Cuando se pasa,
 *  el que llama dice «y N más». */
export const MAX_SECCIONES = 6;

/** Un texto de sección a etiqueta: una línea, corta, sin saltos. */
function recorta(texto: string, max = 42): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

function etiquetaDe(el: Element): string {
  const encabezado = el.querySelector("h1, h2, h3, h4, h5, h6");
  const texto = encabezado?.textContent ?? "";
  if (texto.trim()) return recorta(texto);
  const id = el.getAttribute("id");
  if (id?.trim()) return recorta(`#${id}`);
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return recorta(aria);
  return el.tagName.toLowerCase();
}

/**
 * La IDENTIDAD de una sección entre dos versiones del documento.
 *
 * No se puede usar `data-op-id`: se ESTRIPA antes de guardar, así que ninguno de
 * los dos documentos que compara esto los tiene. Se usa lo estable que hay: la
 * etiqueta HTML más su `id`, y si no hay `id`, su encabezado. Es lo mismo por lo
 * que una persona diría «la sección de precios».
 */
function claveDe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  if (id?.trim()) return `${tag}#${id.trim()}`;
  const encabezado = el.querySelector("h1, h2, h3, h4, h5, h6")?.textContent ?? "";
  const t = encabezado.replace(/\s+/g, " ").trim().toLowerCase();
  return t ? `${tag}:${t}` : tag;
}

/**
 * El contenido, normalizado. El modelo reformatea el HTML constantemente y
 * avisar de un cambio que el usuario NO PUEDE VER es la forma más rápida de que
 * deje de leer los avisos.
 *
 * Dos pasos, y el orden importa:
 *   1. La SANGRÍA entre etiquetas se borra — pero sólo la que lleva un salto de
 *      línea. Un espacio suelto entre dos etiquetas en la MISMA línea sí se ve
 *      («<b>a</b> <i>b</i>» no se pinta igual que «<b>a</b><i>b</i>»), así que
 *      borrarlo a ciegas escondería un cambio real.
 *   2. El resto de rachas de espacio se colapsan a uno, que es lo que hace el
 *      navegador al pintar.
 */
function firmaDe(el: Element): string {
  return el.outerHTML
    .replace(/>\s*\n\s*</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function seccionesDe(html: string): Element[] {
  if (!html.trim()) return [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body?.children ?? []);
  } catch {
    // Un documento que no parsea no es motivo para romper el turno: se dice que
    // no se sabe (lista vacía) y el pie sigue pintando lo de siempre.
    return [];
  }
}

/**
 * Las secciones que cambiaron entre dos versiones del documento.
 *
 * Empareja por CLAVE y en orden: las que casan y difieren salen `cambiada`, las
 * que sobran en el después salen `anadida` y las que sobran en el antes,
 * `quitada`. Mover una sección sin tocarla no produce nada, que es lo honesto:
 * el usuario no perdió ni ganó contenido.
 */
export function seccionesCambiadas(antes: string, despues: string): SeccionCambiada[] {
  const a = seccionesDe(antes);
  const d = seccionesDe(despues);
  if (a.length === 0 && d.length === 0) return [];

  // Índices por clave, en orden de documento. Un sitio con tres `<section>` sin
  // id ni encabezado comparte clave, y se emparejan por orden de aparición —
  // que es lo mejor que se puede hacer sin identidad real.
  const porClave = new Map<string, number[]>();
  a.forEach((el, i) => {
    const k = claveDe(el);
    const lista = porClave.get(k);
    if (lista) lista.push(i);
    else porClave.set(k, [i]);
  });

  const usadasDelAntes = new Set<number>();
  const out: SeccionCambiada[] = [];

  d.forEach((el, i) => {
    const k = claveDe(el);
    const candidatas = porClave.get(k);
    const j = candidatas?.shift();
    if (j === undefined) {
      out.push({ tipo: "anadida", etiqueta: etiquetaDe(el), indice: i });
      return;
    }
    usadasDelAntes.add(j);
    if (firmaDe(a[j]) !== firmaDe(el)) {
      out.push({ tipo: "cambiada", etiqueta: etiquetaDe(el), indice: i });
    }
  });

  a.forEach((el, i) => {
    if (usadasDelAntes.has(i)) return;
    out.push({ tipo: "quitada", etiqueta: etiquetaDe(el), indice: -1 });
  });

  return out;
}
