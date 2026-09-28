/**
 * LA TRANSCRIPCIÓN DEL TURNO — el historial como el de Claude Code (H4, parte 3;
 * plans/len-2/hipotesis/H4-alcance-prompt-e-historial.md).
 *
 * Hasta H4 el historial lo mandaba el NAVEGADOR, y el servidor, por no fiarse,
 * le quitaba los argumentos de cada llamada (el modelo veía «Edit {}») y dejaba
 * cada resultado en un resumen de 400 caracteres. Claude Code guarda su
 * transcripción del lado de confianza, entera, y cuando crece VACÍA los
 * resultados viejos con una marca (`RESULTADO_VACIADO`, su
 * «microcompact») en vez de resumirlos: la llamada se queda, el contenido se va.
 *
 * Aquí igual: el servidor escribe la transcripción de cada turno en
 * `projectChatMessages.transcript` y la reconstruye al empezar el siguiente.
 * Nada de lo que manda el navegador entra en ella.
 *
 * Y LO LEÍDO DURA LA CONVERSACIÓN, como lo leído en Claude Code: se
 * guarda la HUELLA de cada fichero leído, y al empezar el turno siguiente cuenta
 * como leído si no cambió y su resultado sigue a la vista.
 *
 * Decidido en voz alta: Claude Code conserva los N resultados más recientes.
 * Aquí se conserva por CARACTERES, porque
 * nuestros resultados varían cien veces de tamaño (una línea de Grep contra una
 * página entera): `PRESUPUESTO_DE_RESULTADOS`, desde el más reciente.
 *
 * Puro salvo la huella (`node:crypto`).
 */
import { createHash } from "node:crypto";

import type { Message } from "@/lib/ai-gateway";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { normalizarFinales, type Leidos } from "@/lib/agent/ficheros/read";

/** La misma marca que usa Claude Code. */
export const RESULTADO_VACIADO = "[Earlier tool result removed to save space]";

/** Caracteres de resultados que viajan ENTEROS, contando desde el más reciente
 *  (~20 K tokens). Lo que queda más atrás, vaciado. */
export const PRESUPUESTO_DE_RESULTADOS = 80_000;

/** Tope de una transcripción al guardarla. Un turno con muchas lecturas de
 *  páginas grandes no puede escribir megas en la fila: se vacían sus
 *  resultados más viejos hasta caber. */
export const TOPE_TRANSCRIPCION = 400_000;

/** Un mensaje del historial: el `Message` del bucle sin el papel de sistema.
 *  Lo cumplen también los del navegador (`MensajeSaneado`). */
export type MensajeDelHistorial = Omit<Message, "role"> & { role: "user" | "assistant" };

/** Todo lo que el historial pone delante del modelo, como texto: el contenido,
 *  los argumentos de cada llamada y cada respuesta tal y como viaja. Es lo que
 *  cuenta el techo de contexto. */
export function textoDelHistorial(historial: readonly MensajeDelHistorial[]): string {
  return historial
    .map((m) =>
      [
        m.content,
        ...(m.functionCalls ?? []).map((c) => JSON.stringify(c.args ?? {})),
        ...(m.functionResponses ?? []).map((r) => {
          const t = r.response[CLAVE_TOOL_RESULT];
          return typeof t === "string" ? t : JSON.stringify(r.response);
        }),
      ].join("\n"),
    )
    .join("\n");
}

/** Lo leído, guardado como huella: el contenido ya está en la página. */
export interface LecturaGuardada {
  readonly ruta: string;
  readonly huella: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly vistaParcial?: true;
}

export interface TranscripcionGuardada {
  readonly mensajes: Message[];
  readonly leidos: LecturaGuardada[];
}

/** Una fila de `projectChatMessages`, con lo que hace falta para el historial. */
export interface FilaDelHistorial {
  readonly userText: string;
  readonly assistantReasoning: string;
  readonly transcript: TranscripcionGuardada | null;
}

const huella = (texto: string) => createHash("sha1").update(normalizarFinales(texto)).digest("hex");

/** El tamaño de una respuesta tal y como viaja al modelo (ver `fireworks-bridge`). */
function tamanoDeRespuesta(response: Record<string, unknown>): number {
  const texto = response[CLAVE_TOOL_RESULT];
  return typeof texto === "string" ? texto.length : JSON.stringify(response).length;
}

function vaciada(response: Record<string, unknown>): Record<string, unknown> {
  return { ...(typeof response.ok === "boolean" ? { ok: response.ok } : {}), [CLAVE_TOOL_RESULT]: RESULTADO_VACIADO };
}

/** Sólo los cuatro campos de `Message`: nada más se guarda ni se reenvía. */
function limpio<M extends Message | MensajeDelHistorial>(m: M): M {
  return {
    role: m.role,
    content: typeof m.content === "string" ? m.content : "",
    ...(m.functionCalls?.length ? { functionCalls: m.functionCalls.map((c) => ({ name: c.name, args: c.args ?? {} })) } : {}),
    ...(m.functionResponses?.length
      ? { functionResponses: m.functionResponses.map((r) => ({ name: r.name, response: r.response ?? {} })) }
      : {}),
  } as M;
}

/**
 * EL MICROCOMPACT. Recorre las respuestas de la más reciente a la más vieja y
 * deja enteras las que caben en `presupuesto`; a partir de la primera que no
 * cabe, todas las anteriores se vacían (la llamada se queda).
 */
function microcompactar<M extends Message | MensajeDelHistorial>(mensajes: M[], presupuesto: number): M[] {
  let usado = 0;
  let agotado = false;
  const salida = [...mensajes];
  for (let i = salida.length - 1; i >= 0; i--) {
    const m = salida[i]!;
    if (!m.functionResponses?.length) continue;
    const respuestas = [...m.functionResponses].reverse().map((r) => {
      if (r.response[CLAVE_TOOL_RESULT] === RESULTADO_VACIADO) return r;
      const t = tamanoDeRespuesta(r.response);
      if (agotado || usado + t > presupuesto) {
        agotado = true;
        return { name: r.name, response: vaciada(r.response) };
      }
      usado += t;
      return r;
    });
    salida[i] = { ...m, functionResponses: respuestas.reverse() };
  }
  return salida;
}

/** La transcripción del turno lista para la fila: limpia, con la huella de lo
 *  leído y dentro de su tope. */
export function transcripcionParaGuardar(mensajes: readonly Message[], leidos: Leidos): TranscripcionGuardada {
  const lecturas: LecturaGuardada[] = [...leidos].map(([ruta, l]) => ({
    ruta,
    huella: huella(l.instantanea),
    ...(l.offset !== undefined ? { offset: l.offset } : {}),
    ...(l.limit !== undefined ? { limit: l.limit } : {}),
    ...(l.vistaParcial ? { vistaParcial: true as const } : {}),
  }));
  let limpios = mensajes.map(limpio);
  if (JSON.stringify(limpios).length > TOPE_TRANSCRIPCION) limpios = microcompactar(limpios, TOPE_TRANSCRIPCION / 2);
  return { mensajes: limpios, leidos: lecturas };
}

/** El historial de la conversación desde las filas (de la más vieja a la más
 *  reciente), con el microcompact aplicado. */
export function historialDesdeLaBase(
  filas: readonly FilaDelHistorial[],
  presupuesto: number = PRESUPUESTO_DE_RESULTADOS,
): MensajeDelHistorial[] {
  const mensajes: MensajeDelHistorial[] = [];
  for (const f of filas) {
    mensajes.push({ role: "user", content: f.userText });
    if (f.transcript?.mensajes.length) {
      // Del bucle sólo salen mensajes de usuario y de asistente; uno de sistema
      // no tiene sitio en un historial y no se reenvía.
      for (const m of f.transcript.mensajes) if (m.role !== "system") mensajes.push(limpio({ ...m, role: m.role }));
    } else if (f.assistantReasoning.trim()) {
      mensajes.push({ role: "assistant", content: f.assistantReasoning });
    }
  }
  return microcompactar(mensajes, presupuesto);
}

/** Las rutas cuya última lectura o escritura sigue ENTERA en el historial. */
function rutasALaVista(historial: readonly MensajeDelHistorial[]): Set<string> {
  const vistas = new Set<string>();
  const vaciadas = new Set<string>();
  for (let i = historial.length - 1; i >= 0; i--) {
    const m = historial[i]!;
    if (!m.functionResponses?.length) continue;
    const llamadas = historial[i - 1]?.functionCalls ?? [];
    m.functionResponses.forEach((r, j) => {
      const ruta = llamadas[j]?.args?.file_path;
      if (typeof ruta !== "string" || vistas.has(ruta) || vaciadas.has(ruta)) return;
      if (r.response[CLAVE_TOOL_RESULT] === RESULTADO_VACIADO) vaciadas.add(ruta);
      else vistas.add(ruta);
    });
  }
  return vistas;
}

/**
 * Lo que cuenta como leído al empezar el turno: lo que el turno anterior dejó
 * leído, si el fichero NO cambió desde entonces (su huella) y su resultado sigue
 * a la vista en el historial. Si cambió, hay que releerlo —como en Claude Code,
 * que compara con el disco antes de dejar editar—.
 */
export function leidosSembrados(
  guardados: readonly LecturaGuardada[],
  historial: readonly MensajeDelHistorial[],
  contenido: (ruta: string) => string | null,
): Leidos {
  const aLaVista = rutasALaVista(historial);
  const leidos: Leidos = new Map();
  for (const g of guardados) {
    if (!aLaVista.has(g.ruta)) continue;
    const actual = contenido(g.ruta);
    if (actual === null || huella(actual) !== g.huella) continue;
    leidos.set(g.ruta, {
      instantanea: normalizarFinales(actual),
      offset: g.offset,
      limit: g.limit,
      ...(g.vistaParcial ? { vistaParcial: true as const } : {}),
    });
  }
  return leidos;
}
