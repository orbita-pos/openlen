/**
 * EL ANTES Y EL DESPUÉS DE UN FICHERO, por líneas: la lente «Cambios» y la
 * tarjeta del pie del turno (plans/len-agente-2026).
 *
 * La forma de DeepSeek (`2026-09-15-changed-file-diff-preview.md` y
 * `2026-09-14-web-diff-context.md` de `deepseek-harness`): trozos con 3 líneas
 * de contexto a cada lado, los números de línea de los dos lados, las líneas
 * iguales de en medio plegadas, y la vista lado a lado empareja cada tanda de
 * quitadas con las añadidas que la siguen. La tarjeta y la lente cuentan con
 * ESTA misma función, para que no digan números distintos.
 *
 * El algoritmo no es nuevo: es el LCS de `bloquesDelCambio`, probado en el
 * deshacer de Len. Con un fichero enorme ya se rinde solo (`MAX_CELDAS`) y lo
 * que cambia sale en un único bloque —todo lo de antes quitado, todo lo nuevo
 * añadido—, que es el «coarse» de DeepSeek.
 *
 * Puro, sin DOM: corre en el navegador y lo prueba vitest.
 */
import { bloquesDelCambio } from "@/lib/agent/deshacer-lo-de-len";

export const CONTEXTO = 3;

export type TipoDeLinea = "igual" | "quitada" | "anadida";

export interface LineaDelDiff {
  readonly tipo: TipoDeLinea;
  readonly texto: string;
  /** Su número en el fichero de antes (1, 2…); `null` si es añadida. */
  readonly antes: number | null;
  /** Su número en el de después; `null` si es quitada. */
  readonly despues: number | null;
}

export interface TrozoDelDiff {
  /** Líneas iguales plegadas justo ANTES de este trozo. */
  readonly saltadas: number;
  readonly lineas: readonly LineaDelDiff[];
}

export interface DiffDeFichero {
  readonly anadidas: number;
  readonly quitadas: number;
  readonly trozos: readonly TrozoDelDiff[];
  /** Líneas iguales plegadas después del último trozo. */
  readonly saltadasAlFinal: number;
}

/** Las líneas de un texto: un salto final TERMINA la última línea, no abre otra
 *  vacía; un texto vacío (o un fichero que no existe) no tiene ninguna. */
export function lineasDe(texto: string | null): string[] {
  if (!texto) return [];
  const ls = texto.split("\n");
  if (ls.at(-1) === "") ls.pop();
  return ls;
}

export function diffDeFichero(antes: string | null, despues: string | null, contexto = CONTEXTO): DiffDeFichero {
  const a = lineasDe(antes);
  const b = lineasDe(despues);
  const todas: LineaDelDiff[] = [];
  let i = 0;
  let j = 0;
  let quitadas = 0;
  let anadidas = 0;
  const iguales = (hastaA: number) => {
    for (; i < hastaA; i++, j++) todas.push({ tipo: "igual", texto: a[i]!, antes: i + 1, despues: j + 1 });
  };
  for (const bl of bloquesDelCambio(a, b)) {
    iguales(bl.aDesde);
    for (; i < bl.aHasta; i++, quitadas++) todas.push({ tipo: "quitada", texto: a[i]!, antes: i + 1, despues: null });
    for (; j < bl.lHasta; j++, anadidas++) todas.push({ tipo: "anadida", texto: b[j]!, antes: null, despues: j + 1 });
  }
  iguales(a.length);

  // Qué líneas se ven: las cambiadas y `contexto` iguales a cada lado.
  const visible = new Array<boolean>(todas.length).fill(false);
  todas.forEach((l, k) => {
    if (l.tipo === "igual") return;
    for (let x = Math.max(0, k - contexto); x <= Math.min(todas.length - 1, k + contexto); x++) visible[x] = true;
  });
  const trozos: TrozoDelDiff[] = [];
  let saltadas = 0;
  let actual: LineaDelDiff[] | null = null;
  todas.forEach((l, k) => {
    if (!visible[k]) {
      actual = null;
      saltadas++;
      return;
    }
    if (!actual) {
      actual = [];
      trozos.push({ saltadas, lineas: actual });
      saltadas = 0;
    }
    actual.push(l);
  });
  return { anadidas, quitadas, trozos, saltadasAlFinal: saltadas };
}

/** Una fila de la vista lado a lado: lo de antes a la izquierda, lo de después a la derecha. */
export interface FilaLadoALado {
  readonly izquierda: LineaDelDiff | null;
  readonly derecha: LineaDelDiff | null;
}

/** Las líneas de un trozo en dos columnas: cada tanda de quitadas, emparejada
 *  fila a fila con las añadidas que la siguen; lo que sobra, contra un hueco. */
export function filasLadoALado(lineas: readonly LineaDelDiff[]): FilaLadoALado[] {
  const filas: FilaLadoALado[] = [];
  let k = 0;
  while (k < lineas.length) {
    const l = lineas[k]!;
    if (l.tipo === "igual") {
      filas.push({ izquierda: l, derecha: l });
      k++;
      continue;
    }
    const fuera: LineaDelDiff[] = [];
    const dentro: LineaDelDiff[] = [];
    while (k < lineas.length && lineas[k]!.tipo === "quitada") fuera.push(lineas[k++]!);
    while (k < lineas.length && lineas[k]!.tipo === "anadida") dentro.push(lineas[k++]!);
    for (let x = 0; x < Math.max(fuera.length, dentro.length); x++) {
      filas.push({ izquierda: fuera[x] ?? null, derecha: dentro[x] ?? null });
    }
  }
  return filas;
}
