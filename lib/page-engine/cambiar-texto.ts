// CAMBIAR UN TEXTO COMO LO CAMBIA EL `Edit` DE CLAUDE CODE.
//
// El editor mandaba el elemento ENTERO tal y como estaba en pantalla, y el
// servidor lo saneaba: con el texto viajaban los `onclick` del modelo, sus
// iframes y su estado en vivo, y el saneo se llevaba lo primero y guardaba lo
// último. Medido el 2026-09-29: cambiarle el texto a un botón le quitaba el
// `onclick`, y el botón se quedaba mudo sin que nadie lo notase.
//
// `Edit` no reenvía el fichero: nombra el trozo que había (`old_string`) y el
// que va (`new_string`), y todo lo demás sale del disco. Si el trozo ya no está,
// FALLA y lo dice («String to replace not found»); si está más de una vez y no
// se dice cuál, también. Esto es lo mismo sobre un elemento del documento
// GUARDADO: del navegador viajan dos textos, y ni un byte de marcado.
//
// Lo que se toca es un NODO DE TEXTO hijo directo del elemento, cortado por su
// posición en los bytes guardados. La etiqueta de apertura —con su `onclick`—,
// los hermanos y el resto del subárbol no se leen siquiera.
import { parse, type Node as NodoHtml } from "node-html-parser";

export interface CambioDeTexto {
  /**
   * `nodo`: un nodo de texto hijo directo del elemento, entre otros hijos (lo
   * que el editor llama «run»: el texto de un párrafo que además tiene un
   * `<strong>` dentro).
   *
   * `elemento`: el elemento es SÓLO texto, y se sustituye todo su contenido. Es
   * el único modo en el que un salto de línea tiene sentido, porque se escribe
   * como `<br>` entre dos trozos de texto.
   */
  readonly modo: "nodo" | "elemento";
  /** El texto que había, como lo tenía el nodo (sin entidades). */
  readonly antes: string;
  /** El texto que va. Se escribe escapado; un `\n` se escribe como `<br>`. */
  readonly despues: string;
  /**
   * Cuál, si hay varios hijos de texto IGUALES: el índice entre ellos, en orden
   * de documento. Sin él, dos iguales son una ambigüedad y se rechaza, que es
   * lo que hace `Edit` cuando `old_string` no es único.
   */
  readonly ocurrencia?: number;
}

export type ResultadoCambioDeTexto =
  | { readonly ok: true; readonly html: string }
  | {
      readonly ok: false;
      readonly motivo: "texto_no_encontrado" | "texto_ambiguo";
      readonly detalle: string;
    };

const TEXTO = 3;
const ELEMENTO = 1;

/** El navegador normaliza los finales de línea al parsear; los bytes
 *  guardados pueden traer `\r\n`. Se compara lo que el usuario vio. */
function comoLoVe(texto: string): string {
  return texto.replace(/\r\n?/g, "\n");
}

/** El texto nuevo, listo para ir entre etiquetas. */
function escapar(texto: string): string {
  return comoLoVe(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/**
 * `elementoHtml` con el texto cambiado, o el motivo por el que no.
 *
 * `elementoHtml` es el outerHTML del elemento tal y como está GUARDADO, byte a
 * byte. Lo que se devuelve es ese mismo outerHTML con un solo tramo cambiado.
 */
export function cambiarTexto(
  elementoHtml: string,
  cambio: CambioDeTexto,
): ResultadoCambioDeTexto {
  // Sin `pre` entre los bloques de texto crudo (lo trae por defecto): el
  // contenido de un `<pre>` es texto editable como cualquier otro, no un bloque
  // opaco. `script`, `style` y `noscript` sí: su contenido no es texto que el
  // usuario vea.
  const raiz = parse(elementoHtml, {
    comment: true,
    blockTextElements: { script: true, noscript: true, style: true },
  });
  const elemento = raiz.childNodes.find((n) => n.nodeType === ELEMENTO);
  if (!elemento) {
    return { ok: false, motivo: "texto_no_encontrado", detalle: "no hay elemento" };
  }
  const hijos = elemento.childNodes;
  const antes = comoLoVe(cambio.antes);

  if (cambio.modo === "elemento") {
    if (hijos.some((n) => n.nodeType === ELEMENTO)) {
      return {
        ok: false,
        motivo: "texto_no_encontrado",
        detalle: "el elemento guardado ya no es sólo texto",
      };
    }
    const guardado = comoLoVe(hijos.filter((n) => n.nodeType === TEXTO).map((n) => n.text).join(""));
    if (guardado !== antes || hijos.length === 0) {
      return {
        ok: false,
        motivo: "texto_no_encontrado",
        detalle: "el texto guardado no es el que se editó",
      };
    }
    return { ok: true, html: sustituir(elementoHtml, hijos[0]!, hijos[hijos.length - 1]!, cambio.despues) };
  }

  const iguales = hijos.filter((n) => n.nodeType === TEXTO && comoLoVe(n.text) === antes);
  if (iguales.length === 0) {
    return {
      ok: false,
      motivo: "texto_no_encontrado",
      detalle: "el texto que se editó ya no está en el elemento guardado",
    };
  }
  let nodo: NodoHtml;
  if (iguales.length === 1) {
    nodo = iguales[0]!;
  } else {
    const i = cambio.ocurrencia;
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= iguales.length) {
      return {
        ok: false,
        motivo: "texto_ambiguo",
        detalle: `el texto aparece ${iguales.length} veces en el elemento y no se dijo cuál`,
      };
    }
    nodo = iguales[i]!;
  }
  return { ok: true, html: sustituir(elementoHtml, nodo, nodo, cambio.despues) };
}

/** Los bytes de `desde` a `hasta` (ambos incluidos), sustituidos por el texto. */
function sustituir(html: string, desde: NodoHtml, hasta: NodoHtml, texto: string): string {
  const inicio = desde.range[0];
  const fin = hasta.range[1];
  return html.slice(0, inicio) + escapar(texto) + html.slice(fin);
}
