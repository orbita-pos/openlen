// lib/agent/objetivo/evaluar-condicion.ts — ¿se cumplió la condición?
//
// Copiado del mecanismo de objetivos de Claude Code (v2.1.260),
// donde un objetivo NO es una tarea sino una CONDICIÓN DE PARADA, y quien
// decide si se cumplió no es el agente que trabajó:
//
//     «Based on the conversation transcript above, has the following stopping
//      condition been satisfied? Answer based on transcript evidence only.»
//
// Tres piezas de allí que se copian a propósito:
//
//   1. TRES SALIDAS, NO DOS. Su interfaz dice «Goal achieved», «Goal not yet
//      met… continuing» y «Goal could not be achieved». La tercera es la que
//      impide perseguir un imposible para siempre.
//   2. EL EVALUADOR ES DÉBIL A PROPÓSITO: no ejecuta comandos ni lee ficheros.
//      Por eso la condición tiene que traer su chequeo dentro y la evidencia
//      tiene que estar YA en el transcript.
//   3. NO SE FÍA DEL AGENTE. «...accept the agent's own judgment that the
//      condition was met — the agent being evaluated is the one who already
//      decided to cross the line.» Aquí es la regla de la casa escrita en otro
//      idioma: nadie juzga entre el actor y el artefacto.
//
// Corre en el papel `reasoner`, que NO es el de Len (`agent`). Que sean dos
// modelos distintos no es un detalle de coste: es la separación.

import { callModel } from "@/lib/style-match/autofill/model-call";

/** El tope de Claude Code, y por su misma razón: «the user must be able to read
 *  the whole condition in the approval dialog». */
export const CONDICION_MAX = 500;

/**
 * CUÁNTAS VUELTAS EXTRA se le conceden a un objetivo.
 *
 * 🔴 CONSTANTE DEL SERVIDOR, y no un argumento que el modelo proponga. Él
 * propone la CONDICIÓN; el gasto lo decidimos nosotros. Dejar que quien gasta
 * fije su propio tope es exactamente lo que el tope existe para impedir.
 *
 * Y de aquí sale también el número que la tarjeta de aprobación le enseña al
 * usuario. Escribir «hasta 3 turnos» en el texto de la tarjeta sería una
 * promesa que se queda vieja el día que alguien toque esta línea.
 */
export const VUELTAS_DE_OBJETIVO = 2;

/** Lo que el turno puede llegar a costar, en TURNOS. En créditos no se puede
 *  decir: el cobro sale del uso real (`creditsForUsage`), no se sabe antes. */
export const TURNOS_MAXIMOS_CON_OBJETIVO = 1 + VUELTAS_DE_OBJETIVO;

export type Veredicto = "cumplida" | "no_cumplida" | "imposible";

export interface ResultadoEvaluacion {
  readonly veredicto: Veredicto;
  /** Por qué, en una frase. La interfaz de Claude Code lo pinta junto al estado. */
  readonly razon: string;
}

export const SISTEMA_EVALUADOR = [
  "Eres el evaluador de una condición de parada. No trabajaste en esto: sólo lo juzgas.",
  "",
  "🔴 LA REGLA QUE MANDA: la AFIRMACIÓN DEL AGENTE NO ES EVIDENCIA. Que diga «ya",
  "cambié el titular» no prueba nada — el que dice que está hecho es el mismo que",
  "decidió que lo estaba. Evidencia son los RESULTADOS DE HERRAMIENTA y las",
  "MEDICIONES del transcript: el documento tal como quedó, lo que midió el",
  "navegador, lo que devolvió una herramienta. Si el transcript sólo trae el",
  "relato del agente y ningún resultado que lo respalde, la condición NO está",
  "cumplida.",
  "",
  "No puedes ejecutar nada ni abrir ficheros. Juzgas con el transcript y nada más.",
  "",
  "Tres salidas, y sólo tres:",
  '  · "cumplida"    — el transcript trae evidencia de que la condición se cumple.',
  '  · "no_cumplida" — todavía no, o no hay evidencia. Se sigue trabajando.',
  '  · "imposible"   — la condición no puede cumplirse tal y como está escrita',
  "                    (pide algo que el producto no hace, o se contradice).",
  "",
  'Devuelve SÓLO este JSON: {"veredicto": "...", "razon": "una frase"}',
].join("\n");

/** Puro: el mensaje que se le manda. Separado de la llamada para poder fijarlo
 *  con una prueba sin gastar un turno. */
export function promptDeEvaluacion(o: {
  readonly condicion: string;
  readonly transcript: string;
}): string {
  return [
    "<transcript>",
    o.transcript,
    "</transcript>",
    "",
    "Basándote SÓLO en la evidencia del transcript de arriba, ¿se ha cumplido esta",
    "condición de parada?",
    "",
    `Condición: ${o.condicion}`,
  ].join("\n");
}

const VEREDICTOS: readonly string[] = ["cumplida", "no_cumplida", "imposible"];

/** Puro: lee la respuesta del modelo. Devuelve null si no cumple la forma —
 *  y un evaluador que no se entiende NO cuenta como «cumplida». */
export function leerVeredicto(raw: string): ResultadoEvaluacion | null {
  const bloque = /{[\s\S]*}/.exec(raw)?.[0];
  if (!bloque) return null;
  let json: unknown;
  try {
    json = JSON.parse(bloque);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const v = typeof o.veredicto === "string" ? o.veredicto.trim().toLowerCase() : "";
  if (!VEREDICTOS.includes(v)) return null;
  const razon = typeof o.razon === "string" ? o.razon.trim() : "";
  return { veredicto: v as Veredicto, razon };
}

export async function evaluarCondicion(o: {
  readonly condicion: string;
  readonly transcript: string;
  readonly signal?: AbortSignal;
}): Promise<{ ok: true; resultado: ResultadoEvaluacion } | { ok: false; motivo: string }> {
  if (o.condicion.trim().length === 0) return { ok: false, motivo: "condicion_vacia" };
  if (o.condicion.length > CONDICION_MAX) return { ok: false, motivo: "condicion_larga" };

  const r = await callModel({
    system: SISTEMA_EVALUADOR,
    user: promptDeEvaluacion({ condicion: o.condicion, transcript: o.transcript }),
    operation: "condition_evaluation",
    requestId: "objetivo-evaluar-condicion",
    maxOutputTokens: 400,
    // Un juicio no se sortea: la misma evidencia tiene que dar el mismo
    // veredicto tantas veces como se le pregunte.
    temperature: 0,
    jsonObject: true,
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (!r.ok) return { ok: false, motivo: r.kind };

  const leido = leerVeredicto(r.raw);
  // 🔴 SIN FORMA NO HAY VEREDICTO, y el fallo NO cae del lado de «cumplida»:
  // un evaluador que no se entiende dejaría pasar por bueno un turno a medias.
  return leido ? { ok: true, resultado: leido } : { ok: false, motivo: "respuesta_ilegible" };
}
