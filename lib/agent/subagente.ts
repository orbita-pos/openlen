// lib/agent/subagente.ts — un subagente de SOLO LECTURA sobre el mismo bucle de Len.
//
// H14 (paso 8 de Len 2.5). En Claude Code los revisores de `/code-review` son
// subagentes: el MISMO bucle, con su propio prompt, contexto limpio y sólo las
// herramientas que les tocan. Aquí igual: `runAgentLoop` con un prompt de
// sistema, sus mensajes y Read, Grep y Glob sobre el sitio. Nunca la conversación
// de Len. Es la base de la idea de Jesús del subagente para las tareas
// difíciles: se amplía esto, no se hace otra pieza.
//
// Lo que se aparta de Claude Code, y por qué:
//   · EL TOPE. Claude Code topa un agente con `maxTurns` y, al llegar, lo corta
//     y se queda con su último mensaje. A un revisor cortado a media lectura le
//     falta justo el JSON, y lo encontrado se perdería. Aquí la vuelta de
//     después del tope va SIN herramientas y se le pide contestar con lo que
//     tenga: es lo que ya hace nuestro bucle al agotar un tope (`closeOut`).
//     Se topa porque la revisión la paga la casa y se come la espera del turno
//     del usuario; nuestro bucle no puede toparlo (las lecturas no cuentan).
//   · Quién corre cada vuelta, cómo se lee y qué modelo es vienen INYECTADOS,
//     como en el bucle: así se prueba con streams guionados y sin gastar.

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { ToolOutcome } from "@/lib/agent/tools";
import { runAgentLoop } from "@/lib/agent/loop";
import type { Corrida } from "@/lib/agent/revision/revisar-turno";

/** Lo que puede usar: leer, buscar y listar. Nada que escriba. */
export const HERRAMIENTAS_DE_SOLO_LECTURA: ReadonlySet<string> = new Set(["Read", "Grep", "Glob"]);

/** Las declaraciones que se le ofrecen, de la lista entera de Len. Las mismas
 *  para el cerebro (lo que el modelo ve) y para el bucle (lo que acepta). */
export function declaracionesDeSoloLectura(declaraciones: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return declaraciones.filter((d) => HERRAMIENTAS_DE_SOLO_LECTURA.has(String(d.name)));
}

/** Vueltas (llamadas al modelo) antes de pedirle que conteste. Se mide en la
 *  primera pasada por las grabaciones (paso 6). */
export const MAX_VUELTAS_DEL_SUBAGENTE = 8;

export const CONTESTA_YA =
  "You have used the reading budget for this task. Do not call any more tools: answer now with what you have found, in exactly the output format you were given.";

const SOLO_LECTURA =
  "This agent is read-only: it can use Read, Grep and Glob, and nothing that changes the site.";

export async function correrSubagente(o: {
  readonly sistema: string;
  /** Sus mensajes de usuario, en orden: lo común primero, para que se lea de
   *  caché entre subagentes hermanos, y lo propio de éste al final. */
  readonly mensajes: readonly string[];
  /** Las declaraciones de herramientas; se le ofrecen sólo las de lectura. */
  readonly declaraciones: readonly Record<string, unknown>[];
  openStream(messages: Message[]): AsyncIterable<StreamEvent>;
  /** Herramientas apagadas: la vuelta de después del tope. */
  closeOut(messages: Message[]): AsyncIterable<StreamEvent>;
  /** Ejecuta una lectura sobre el sitio, con su propia sesión. */
  leer(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
}): Promise<Corrida> {
  const tools = declaracionesDeSoloLectura(o.declaraciones);
  let vueltas = 0;
  const r = await runAgentLoop({
    messages: [{ role: "system", content: o.sistema }, ...o.mensajes.map((content): Message => ({ role: "user", content }))],
    tools,
    openStream: (messages) => {
      vueltas += 1;
      return vueltas <= MAX_VUELTAS_DEL_SUBAGENTE
        ? o.openStream(messages)
        : o.closeOut([...messages, { role: "user", content: CONTESTA_YA }]);
    },
    closeOut: o.closeOut,
    // El bucle ya rechaza lo que no se le declaró; esto es la segunda puerta de
    // una garantía que no puede fallar: el revisor no escribe en el sitio de
    // nadie.
    runTool: async (name, args) =>
      HERRAMIENTAS_DE_SOLO_LECTURA.has(name) ? await o.leer(name, args) : { response: { ok: false, error: SOLO_LECTURA } },
    emit: () => {},
  });
  const uso = r.usage;
  if (r.terminalError) return { ok: false, motivo: r.errorCode ?? r.topeAlcanzado ?? "error", uso };
  return { ok: true, texto: r.finalText, uso };
}
