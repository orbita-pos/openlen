// lib/len-bench/puntuar.ts — cómo se puntúa una corrida y un caso.
//
// Copiado del corredor de evals de Claude Code (memoria
// `claude-code-plugin-eval-estructura`): el score de una corrida es la
// fracción PONDERADA de los graders que votan; el caso es la media de sus
// corridas y su passRate, la fracción de corridas perfectas; y las NOTAS
// nombran a UNO, el que más pesa de los que fallan, salvo que la corrida
// tuviera un error, que manda.

import type { Desenlace, Nivel, ResultadoDeCaso, ResultadoDeCorrida, ResultadoDeGrader } from "./tipos";

/**
 * Las corridas que el ARNÉS no pudo medir: el proveedor que no contestó, el
 * cliente simulado que se salió de su ficha. Como en el
 * corredor de evals de Claude Code: cuentan como 0 —no se quitan en
 * silencio— y dejan la suite en error, porque sus números no valen. Hasta el
 * 2026-09-23 se repetían una vez y se quitaban del cálculo: con dos de tres
 * fallidas, el passRate salía de UNA corrida y la tabla no lo decía.
 */
export const DEL_ARNES: ReadonlySet<Desenlace> = new Set<Desenlace>(["proveedor", "cliente_fuera_de_ficha"]);

export function puntuarCorrida(graders: readonly ResultadoDeGrader[]): number {
  const votan = graders.filter((x) => x.puntua);
  const total = votan.reduce((s, x) => s + x.peso, 0);
  if (total === 0) return 0;
  return votan.filter((x) => x.paso).reduce((s, x) => s + x.peso, 0) / total;
}

export function notasDeCorrida(c: Pick<ResultadoDeCorrida, "graders" | "error">): string {
  if (c.error) return c.error;
  let peor: ResultadoDeGrader | null = null;
  for (const x of c.graders) {
    if (x.puntua && !x.paso && (!peor || x.peso > peor.peso)) peor = x;
  }
  return peor ? `${peor.nombre}: ${peor.explicacion}` : "";
}

export function resumirCaso(id: string, nivel: Nivel, corridas: readonly ResultadoDeCorrida[]): ResultadoDeCaso {
  // Las que saltó el tope no se llegaron a correr: en Claude Code ni se apuntan.
  const medidas = corridas.filter((c) => c.desenlace !== "tope_de_gasto");
  if (medidas.length === 0) {
    return { id, nivel, corridas, score: 0, passRate: 0, notas: "sin corridas medidas: las saltó el tope de gasto" };
  }
  const scoreDe = (c: ResultadoDeCorrida) => (DEL_ARNES.has(c.desenlace) ? 0 : c.score);
  const score = medidas.reduce((s, c) => s + scoreDe(c), 0) / medidas.length;
  const passRate = medidas.filter((c) => scoreDe(c) >= 1).length / medidas.length;
  const primeraMala = medidas.find((c) => scoreDe(c) < 1);
  return { id, nivel, corridas, score, passRate, notas: primeraMala ? notasDeCorrida(primeraMala) : "" };
}

/**
 * Con qué código sale la suite, como el corredor de Claude Code: 2 si quedó a
 * medias (el tope saltó corridas), 1 si el arnés no pudo medir alguna, 0 si
 * todo se midió. De Claude Code NO se copia el 1 por no llegar al umbral de
 * aprobado: aquello es un corredor de pruebas, y esta vara ESPERA que 1.5
 * suspenda la mayoría de los casos.
 */
export function salidaDeLaSuite(casos: readonly ResultadoDeCaso[], parcial: boolean): { codigo: 0 | 1 | 2; aviso?: string } {
  if (parcial) return { codigo: 2, aviso: "⚠ a medias: el tope de gasto saltó corridas; el número no es el de la suite entera" };
  const fallos = casos.reduce((s, c) => s + c.corridas.filter((r) => DEL_ARNES.has(r.desenlace)).length, 0);
  if (fallos > 0) {
    return {
      codigo: 1,
      aviso: `✘ ${fallos} corrida(s) no las pudo medir el arnés (proveedor o cliente simulado); cuentan como 0 y estos números NO valen: repite la corrida`,
    };
  }
  return { codigo: 0 };
}

/**
 * Las dos vías (decisión 9, de lo público de Anthropic: Claude Code no las
 * distingue). La vara de la fase 0 —el 20–40 %— es la media de CAPACIDAD; de
 * REGRESIÓN se cuenta cuántos siguen al 100 %, y los que no se nombran: son el
 * «cero regresiones» de la puerta.
 */
export function resumenPorVia(
  casos: readonly ResultadoDeCaso[],
  regresion: ReadonlySet<string>,
): {
  capacidad: { casos: number; passMedio: number };
  regresion: { casos: number; alCien: number; caidos: string[] };
} {
  const cap = casos.filter((c) => !regresion.has(c.id));
  const reg = casos.filter((c) => regresion.has(c.id));
  return {
    capacidad: { casos: cap.length, passMedio: cap.length ? cap.reduce((s, c) => s + c.passRate, 0) / cap.length : 0 },
    regresion: { casos: reg.length, alCien: reg.filter((c) => c.passRate >= 1).length, caidos: reg.filter((c) => c.passRate < 1).map((c) => c.id) },
  };
}
