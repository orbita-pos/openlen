/**
 * EL GEMELO CON POSICIONES — cada elemento dice en qué línea del fichero está.
 *
 * Len 2.0 trabaja con líneas de fichero, como Claude Code: Read las numera,
 * Edit reemplaza trozos, y lo que el arnés le cuenta (lo que el dueño señaló en
 * el lienzo, un diagnóstico) tiene que llegar anclado a una línea que pueda ir
 * a leer. El navegador y el motor, en cambio, señalan ELEMENTOS.
 *
 * El puente es este gemelo: el mismo HTML con `data-op-id="L<línea>C<col>"` en
 * cada etiqueta de apertura. Cualquier cosa que ya sepa devolver el `data-op-id`
 * de un elemento (el resolvedor del pin, las sondas de la medición) devuelve así
 * su posición en el fichero, sin tocar ninguna de esas piezas.
 *
 * 🔴 NO SE USA EL ETIQUETADOR DEL MOTOR (`tagWithOpIds`): reescribe la etiqueta
 * que toca (lol_html cambia `/>` por ` />` y junta en una línea los atributos
 * que venían en varias). Medido el 2026-09-24 sobre `templates/starter`: 131 de
 * 245 páginas no volvían byte a byte al quitarle los ids, y en `encargo-grande`
 * las líneas se corrían. Aquí sólo se INSERTA: quitando los atributos vuelve el
 * fichero exacto.
 *
 * Las posiciones son del fichero que ve Len: el HTML sin los `data-op-id`
 * viejos (`sinOpIds`), igual que lo sirve Read. Línea y columna desde 1, las
 * de `[Line L:C]` en los diagnósticos de Claude Code.
 *
 * Sin imports: lo prueba vitest sin binding nativo.
 */

/** Las etiquetas que el motor no etiqueta (`SKIP_TAGS` de `tagger.rs`). Se
 *  copia la lista para que el gemelo señale lo mismo que señalaba el de ids. */
const SIN_ID = new Set(["html", "head", "meta", "title", "link", "script", "style", "noscript", "br", "hr"]);

/** Contenido que el HTML no parsea como marcado: lo de dentro es texto. */
const TEXTO_CRUDO = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);

const NOMBRE = /[a-zA-Z][^\s/>]*/y;
const ID_DE_POSICION = /^L(\d+)C(\d+)$/;
const ATRIBUTO_DE_POSICION = / data-op-id="L\d+C\d+"/g;

/** Dónde termina la etiqueta que empieza en `desde` (el índice de su `>`),
 *  respetando los valores entre comillas: `<p title="a > b">`. */
function finDeEtiqueta(html: string, desde: number): number {
  let j = desde;
  while (j < html.length && html[j] !== ">") {
    if (html[j] === "=") {
      j++;
      while (j < html.length && /\s/.test(html[j]!)) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const cierre = html.indexOf(q, j + 1);
        j = cierre === -1 ? html.length : cierre + 1;
      }
      continue;
    }
    j++;
  }
  return j;
}

export function etiquetarConPosiciones(html: string): string {
  const trozos: string[] = [];
  let copiado = 0;
  let linea = 1;
  let inicioDeLinea = 0;
  let contado = 0;
  const posicion = (i: number) => {
    for (let k = contado; k < i; k++) {
      if (html.charCodeAt(k) === 10) {
        linea++;
        inicioDeLinea = k + 1;
      }
    }
    contado = i;
    return `L${linea}C${i - inicioDeLinea + 1}`;
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const fin = html.indexOf("-->", lt + 4);
      i = fin === -1 ? html.length : fin + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const fin = html.indexOf("]]>", lt + 9);
      i = fin === -1 ? html.length : fin + 3;
      continue;
    }
    const siguiente = html[lt + 1];
    if (siguiente === "!" || siguiente === "?" || siguiente === "/") {
      const fin = html.indexOf(">", lt + 1);
      i = fin === -1 ? html.length : fin + 1;
      continue;
    }
    NOMBRE.lastIndex = lt + 1;
    const m = NOMBRE.exec(html);
    if (!m) {
      i = lt + 1;
      continue;
    }
    const nombre = m[0].toLowerCase();
    const finNombre = lt + 1 + m[0].length;
    const fin = finDeEtiqueta(html, finNombre);
    const yaTiene = /\sdata-op-id\s*=/i.test(html.slice(finNombre, fin));
    if (!SIN_ID.has(nombre) && !yaTiene) {
      trozos.push(html.slice(copiado, finNombre), ` data-op-id="${posicion(lt)}"`);
      copiado = finNombre;
    }
    i = fin + 1;
    if (TEXTO_CRUDO.has(nombre)) {
      const cierre = new RegExp(`</${nombre}(?=[\\s/>])`, "gi");
      cierre.lastIndex = i;
      const c = cierre.exec(html);
      i = c ? c.index : html.length;
    }
  }
  trozos.push(html.slice(copiado));
  return trozos.join("");
}

/** Quita lo que puso `etiquetarConPosiciones`, y nada más. */
export function quitarPosiciones(html: string): string {
  return html.replace(ATRIBUTO_DE_POSICION, "");
}

/** La línea y la columna de un id del gemelo; `null` si no es uno. */
export function posicionDeId(id: string): { linea: number; columna: number } | null {
  const m = ID_DE_POSICION.exec(id);
  return m ? { linea: Number(m[1]), columna: Number(m[2]) } : null;
}

function indiceDe(html: string, linea: number, columna: number): number | null {
  let inicio = 0;
  for (let l = 1; l < linea; l++) {
    const nl = html.indexOf("\n", inicio);
    if (nl === -1) return null;
    inicio = nl + 1;
  }
  const i = inicio + columna - 1;
  return i <= html.length ? i : null;
}

/**
 * Las líneas del fichero que ocupa un elemento del gemelo.
 *
 * `trozoDelGemelo` es el outerHTML del elemento TAL CUAL está en el gemelo
 * (`outerHtmlByOpId`, que recorta entre bordes sin reserializar). Quitándole las
 * posiciones es el texto del fichero; si no está exactamente donde dice su id,
 * no se ancla: una línea inventada es peor que ninguna.
 */
export function seleccionDelTrozo(
  html: string,
  id: string,
  trozoDelGemelo: string,
): { desde: number; hasta: number; contenido: string } | null {
  const pos = posicionDeId(id);
  if (!pos) return null;
  const inicio = indiceDe(html, pos.linea, pos.columna);
  if (inicio === null) return null;
  const contenido = quitarPosiciones(trozoDelGemelo);
  if (contenido === "" || !html.startsWith(contenido, inicio)) return null;
  const saltos = contenido.match(/\n/g)?.length ?? 0;
  // Read quita el `\r` del final de cada línea: lo que se enseña, igual.
  return { desde: pos.linea, hasta: pos.linea + saltos, contenido: contenido.replace(/\r\n/g, "\n") };
}
