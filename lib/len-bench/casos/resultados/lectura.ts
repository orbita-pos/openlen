// Cómo se LEE lo que dijo Len en los casos de resultados (plans/len-resultados/).
// Puro y con su prueba: un patrón demasiado laxo aprueba lo que debía cazar, y
// eso se descubre gastando.
import type { ContextoDeCalificacion } from "../../tipos";

/** Lo que dijo Len en la corrida, mensaje a mensaje. */
export const deLen = (ctx: Pick<ContextoDeCalificacion, "conversacion">): string[] =>
  ctx.conversacion.filter((x) => x.quien === "len").map((x) => x.texto);

/**
 * ¿Dijo que HOY lleva `n`? El número tiene que ser de «hoy»: o va detrás de
 * «hoy» sin otra cifra en medio («Hoy, hasta ahora, llevas 3 visitas»), o justo
 * delante de «visitas hoy» («llevas 3 visitas hoy»). Así «Hoy llevas 0
 * visitas; ayer, 3» y «Ayer tuviste 3 visitas y hoy ninguna» —la trampa de
 * contar en UTC— NO pasan aunque digan «hoy» y «3».
 */
export function diceHoy(textos: readonly string[], n: number, enLetra: string): boolean {
  const num = `(?:${n}|${enLetra})`;
  const detras = new RegExp(`\\bhoy\\b[^0-9.;\\n]{0,60}\\b${num}\\b`, "i");
  const delante = new RegExp(`\\b${num}\\s+(?:visitas?|personas?)\\s+(?:hoy|en lo que va de hoy)\\b`, "i");
  return textos.some((t) => detras.test(t) || delante.test(t));
}

/** Contarle sus resultados sin que los pida: nombrar a quien escribió, o
 *  hablar de mensajes o formularios nuevos, o de visitas. «tus visitantes» NO
 *  cuenta —es una forma normal de hablar de una página—, ni «el mensaje de
 *  WhatsApp» del botón. Devuelve los patrones que casaron. */
export function leCuentaResultados(textos: readonly string[], nombres: readonly string[]): string[] {
  const t = textos.join("\n");
  const patrones = [
    ...nombres.map((n) => new RegExp(`\\b${n}\\b`)),
    /\b(?:mensajes?|formularios?)\b[^.\n]{0,40}\b(?:nuevos?|sin leer|sin ver|pendientes?)\b/i,
    /\bvisitas\b/i,
  ];
  return patrones.filter((re) => re.test(t)).map(String);
}
