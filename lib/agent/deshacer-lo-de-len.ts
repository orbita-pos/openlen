// lib/agent/deshacer-lo-de-len.ts — deshacer la última escritura de Len SIN
// llevarse lo que el dueño editó después.
//
// 🔴 EL FALLO QUE CIERRA (H06 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`).
// `revertir_ultimo_cambio` restauraba `versiones[1]`, fuera de quien fuera. El
// editor sólo guarda versión de una edición de contenido si pasaron cinco
// minutos desde la anterior, así que había dos caminos y los dos eran malos:
//
//  · el dueño edita a mano poco después de un turno de Len → no hay versión
//    suya, el deshacer vuelve al «antes» de Len y el texto del dueño
//    desaparece de la página viva;
//  · pasaron más de cinco minutos → la última versión ES la del dueño, así que
//    se deshace SU edición y se conserva la de Len.
//
// LA VARA ES CLAUDE CODE: no descarta lo que no escribió. Para deshacer lo suyo
// sobre un fichero que el usuario ya tocó, edita el contenido ACTUAL revirtiendo
// sólo su cambio. Aquí eso es exacto, no una reconstrucción de memoria: se
// conocen los dos documentos de la escritura de Len (`antes` → `delLen`), así
// que su cambio se invierte bloque a bloque sobre el documento de ahora.
//
// FALLA CERRADO. Si un bloque de Len no aparece tal cual —y en un solo sitio,
// con el contexto que haga falta para distinguirlo— en el documento actual, es que el dueño tocó lo mismo que Len, y ahí no hay forma
// correcta de elegir por él: se devuelve `se_solapan` y la herramienta le dice
// al modelo que pregunte. Nunca se aplica a medias.
//
// Puro: cadenas dentro, cadena fuera.

/**
 * LA ÚLTIMA ESCRITURA DE LEN en una lista de versiones del más nuevo al más
 * viejo: la primera que escribió el Agente (`source: "chat"`). Devuelve su
 * posición, o -1 si en esa página Len no escribió nunca.
 *
 * Una sola definición para las dos preguntas que dependen de ella: qué se
 * deshace (`revertir_ultimo_cambio`) y qué cambió el dueño desde entonces (el
 * bloque de contexto de `cambios-del-dueno.ts`). Si una mirara la última
 * versión y la otra la última de Len, contestarían sobre dos «antes» distintos.
 */
export function ultimaEscrituraDeLen(versiones: readonly { readonly source?: string }[]): number {
  return versiones.findIndex((v) => v.source === "chat");
}

export type ResultadoDeDeshacer =
  | { readonly ok: true; readonly html: string; readonly bloques: number }
  | { readonly ok: false; readonly motivo: "se_solapan" | "sin_cambios_de_len" };

/** Hasta cuántas líneas de contexto se añaden para que un bloque sea único.
 *
 *  El contexto CRECE sólo si hace falta: primero se busca el bloque de Len a
 *  secas, y sólo si aparece varias veces se le pegan líneas vecinas. Con un
 *  contexto fijo, un titular editado por el dueño dos líneas encima del botón
 *  que tocó Len bastaba para declarar un choque que no existe — lo cazó la
 *  primera prueba de este fichero. */
const MAX_CONTEXTO = 6;

/**
 * EL DOCUMENTO EN PIEZAS: se corta DETRÁS de cada `>`, y `join("")` lo devuelve
 * byte a byte.
 *
 * Por líneas no servía: hay páginas guardadas en una sola línea, y ahí
 * cualquier edición del dueño caía en «la misma línea» que la de Len y el
 * deshacer se negaba siempre — lo cazó el doble de `tools.test.ts`, cuyo
 * documento es de una línea. Por etiqueta, la granularidad es la misma con
 * formato o sin él.
 */
export function trocear(html: string): string[] {
  return html.split(/(?<=>)/);
}

/** Por encima de esto la tabla del LCS no se calcula: el cambio de Len entero
 *  se trata como un solo bloque, que sólo se deshace si sigue intacto. */
const MAX_CELDAS = 4_000_000;

export interface Bloque {
  /** [aDesde, aHasta) en `antes`, [lDesde, lHasta) en `delLen`. */
  readonly aDesde: number;
  readonly aHasta: number;
  readonly lDesde: number;
  readonly lHasta: number;
}

/** Los bloques que cambian de `a` a `l`, en orden. */
export function bloquesDelCambio(a: readonly string[], l: readonly string[]): Bloque[] {
  let inicio = 0;
  while (inicio < a.length && inicio < l.length && a[inicio] === l[inicio]) inicio += 1;
  let finA = a.length;
  let finL = l.length;
  while (finA > inicio && finL > inicio && a[finA - 1] === l[finL - 1]) {
    finA -= 1;
    finL -= 1;
  }
  const n = finA - inicio;
  const m = finL - inicio;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELDAS) {
    return [{ aDesde: inicio, aHasta: finA, lDesde: inicio, lHasta: finL }];
  }
  // LCS por programación dinámica sobre el tramo que cambia, recorrido desde
  // el final para poder reconstruir hacia delante.
  const ancho = m + 1;
  const tabla = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabla[i * ancho + j] =
        a[inicio + i] === l[inicio + j]
          ? tabla[(i + 1) * ancho + j + 1]! + 1
          : Math.max(tabla[(i + 1) * ancho + j]!, tabla[i * ancho + j + 1]!);
    }
  }
  const bloques: Bloque[] = [];
  let i = 0;
  let j = 0;
  let abierto: { aDesde: number; lDesde: number } | null = null;
  const cerrar = () => {
    if (abierto) {
      bloques.push({ aDesde: abierto.aDesde, aHasta: inicio + i, lDesde: abierto.lDesde, lHasta: inicio + j });
      abierto = null;
    }
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[inicio + i] === l[inicio + j]) {
      cerrar();
      i += 1;
      j += 1;
    } else {
      abierto ??= { aDesde: inicio + i, lDesde: inicio + j };
      if (j < m && (i === n || tabla[i * ancho + j + 1]! >= tabla[(i + 1) * ancho + j]!)) j += 1;
      else i += 1;
    }
  }
  cerrar();
  return bloques;
}

/** En qué posiciones de `pajar` empieza `aguja`. */
function apariciones(pajar: readonly string[], aguja: readonly string[]): number[] {
  const donde: number[] = [];
  for (let k = 0; k + aguja.length <= pajar.length; k++) {
    let igual = true;
    for (let x = 0; x < aguja.length; x++) {
      if (pajar[k + x] !== aguja[x]) {
        igual = false;
        break;
      }
    }
    if (igual) donde.push(k);
  }
  return donde;
}

/**
 * Invierte la escritura `antes` → `delLen` sobre `actual`.
 *
 * Si `actual` ES lo que dejó Len, el resultado es exactamente `antes`. Si el
 * dueño cambió otra cosa, su cambio se conserva. Si cambió lo mismo, no se toca
 * nada y se dice.
 */
export function deshacerSobreLoActual(o: {
  readonly antes: string;
  readonly delLen: string;
  readonly actual: string;
}): ResultadoDeDeshacer {
  const a = trocear(o.antes);
  const l = trocear(o.delLen);
  const bloques = bloquesDelCambio(a, l);
  if (bloques.length === 0) return { ok: false, motivo: "sin_cambios_de_len" };
  let actual = trocear(o.actual);
  // Del último al primero: así un bloque ya invertido no mueve el ancla de los
  // que quedan por encima.
  for (let b = bloques.length - 1; b >= 0; b--) {
    const bloque = bloques[b]!;
    const suyo = l.slice(bloque.lDesde, bloque.lHasta);
    // Un borrado de Len no deja nada que buscar: el ancla son sus vecinas.
    let invertido: string[] | null = null;
    for (let k = suyo.length === 0 ? 1 : 0; k <= MAX_CONTEXTO; k++) {
      const ctxAntes = l.slice(Math.max(0, bloque.lDesde - k), bloque.lDesde);
      const ctxDespues = l.slice(bloque.lHasta, bloque.lHasta + k);
      const aguja = [...ctxAntes, ...suyo, ...ctxDespues];
      if (aguja.length === 0) break;
      const donde = apariciones(actual, aguja);
      // No está: el dueño tocó lo mismo (o sus vecinas). Más contexto no lo
      // va a arreglar.
      if (donde.length === 0) break;
      if (donde.length > 1) continue;
      invertido = [
        ...actual.slice(0, donde[0]! + ctxAntes.length),
        ...a.slice(bloque.aDesde, bloque.aHasta),
        ...actual.slice(donde[0]! + aguja.length - ctxDespues.length),
      ];
      break;
    }
    if (!invertido) return { ok: false, motivo: "se_solapan" };
    actual = invertido;
  }
  return { ok: true, html: actual.join(""), bloques: bloques.length };
}
