// LA SALIDA DE UN COMANDO, DENTRO DE SU TARJETA DEL CHAT (la #5 de
// plans/len-agente-2026/notas/fase-5-taller.md).
//
// La tarjeta de `bash` se despliega como en Claude Code y DeepSeek: el comando y
// las primeras líneas de lo que imprimió, y «+N líneas» para verlo entero. La
// salida NO viaja en la tarjeta (`projectChatMessages.actions` se le reenvía al
// modelo y crecería con cada `cat`): está en el almacén en vivo durante el turno
// y, después, en la transcripción, que es de donde la lee la lente «Terminal».
//
// Lo único que la tarjeta guarda del comando es su resumen (`action.summary`,
// `resumenDelComando`). Se casa por ORDEN —la k-ésima tarjeta de `bash` del
// turno con el k-ésimo comando— y el resumen lo confirma; si el orden no cuadra
// (una llamada sin comando no deja salida), gana el comando con el mismo resumen
// más cercano a esa posición. Puro: lo prueba vitest.

import { resumenDelComando } from "@/lib/agent/terminal/resumen-del-comando";
import type { CambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";

export interface ComandoConSalida {
  readonly command: string;
  /** Lo que imprimió, tal como lo leyó el modelo. Null: no se guardó. */
  readonly salida: string | null;
  readonly exitCode: number | null;
  /** Lo que cambió en los ficheros (la #10). */
  readonly cambios?: CambiosDelComando;
}

export function salidaDelComando<T extends ComandoConSalida>(
  comandos: readonly T[],
  indice: number,
  resumen: string,
): T | null {
  const enSuSitio = comandos[indice];
  if (enSuSitio && resumenDelComando(enSuSitio.command) === resumen) return enSuSitio;
  let mejor: T | null = null;
  let distancia = Infinity;
  comandos.forEach((c, i) => {
    if (resumenDelComando(c.command) !== resumen) return;
    const d = Math.abs(i - indice);
    if (d < distancia) {
      mejor = c;
      distancia = d;
    }
  });
  return mejor;
}

/** Las líneas que se ven sin desplegar: las de Claude Code. */
export const LINEAS_PLEGADAS = 3;

/** Plegada, cada línea va en UNA fila de la tarjeta (~40 caracteres de ancho);
 *  si alguna es más larga se corta con «…», y entonces también hay algo que
 *  desplegar aunque no sobren líneas: un `cat` de un HTML en una sola línea. */
const CARACTERES_POR_FILA = 40;

export interface SalidaPlegada {
  /** Todas las líneas, sin lo que dice el código: la última de antes
   *  («[Command finished…]»), el «Exit code N» de arriba de Claude Code, ni su
   *  «(bash completed with no output)». */
  readonly lineas: readonly string[];
  /** Las que se ven plegada. */
  readonly cabeza: readonly string[];
  /** Cuántas quedan debajo. */
  readonly resto: number;
  /** Si hay algo más que ver al desplegar (líneas de más, o líneas cortadas). */
  readonly hayMas: boolean;
}

/** En la lente «Terminal» caben más: las 16 de la terminal de DeepSeek fuera del chat. */
export const LINEAS_EN_LA_LENTE = 16;

export interface CabezaYCola {
  /** Las primeras, que se ven. */
  readonly cabeza: readonly string[];
  /** Cuántas quedan plegadas en medio; 0, ninguna (se ve todo). */
  readonly ocultas: number;
  /** Las últimas, que también se ven: en una terminal el final suele ser el resultado. */
  readonly cola: readonly string[];
}

/**
 * EL PLEGADO DE LA LENTE (la #14): por encima del tope, la mitad de arriba y la
 * de abajo, y en medio cuántas faltan — como el bloque de terminal de DeepSeek
 * (mitad de arriba redondeada hacia arriba). Hasta el tope, todo.
 */
export function cabezaYCola(lineas: readonly string[], max: number = LINEAS_EN_LA_LENTE): CabezaYCola {
  const ocultas = lineas.length - max;
  if (ocultas <= 0) return { cabeza: lineas, ocultas: 0, cola: [] };
  const arriba = Math.ceil(max / 2);
  return { cabeza: lineas.slice(0, arriba), ocultas, cola: lineas.slice(lineas.length - (max - arriba)) };
}

export function plegarSalida(salida: string): SalidaPlegada {
  // El código lo pinta la tarjeta aparte (como la lente): fuera la línea que lo dice.
  const cuerpo = salida
    .replace(/\n?\[Command finished with exit code -?\d+\]\s*$/, "")
    .replace(/^Exit code -?\d+(?:\n|$)/, "")
    .replace(/^\(bash completed with no output\)$/, "")
    .replace(/\s+$/, "");
  const lineas = cuerpo === "" ? [] : cuerpo.split("\n");
  const cabeza = lineas.slice(0, LINEAS_PLEGADAS);
  const resto = lineas.length - cabeza.length;
  const hayMas = resto > 0 || cabeza.some((l) => l.length > CARACTERES_POR_FILA);
  return { lineas, cabeza, resto, hayMas };
}
