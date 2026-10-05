/**
 * LAS TRES HERRAMIENTAS DE BUSCAR EN CHARLAS PASADAS — pieza 5 de Len 2.5:
 * `session_search`, `session_event_search` y `session_event_read` de DeepSeek
 * (`deepseek-harness` @ 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt:
 * packages/session-query/tool-session-query/src/{index,input}.ts). Las
 * descripciones de la herramienta y de cada parámetro son las suyas, copiadas;
 * de sus parámetros quedan los que significan algo aquí (sin padres, linaje,
 * disponibilidad ni superficies), y sin `session_trace`/`session_event_trace`:
 * Len no tiene sesiones bifurcadas. Lo nuestro es UNA frase por herramienta:
 * qué es aquí una sesión.
 *
 * La búsqueda y los formatos viven en `lib/agent/session-query.ts`.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import {
  SessionQueryInputError,
  eventSearch,
  findEvent,
  formatEventRead,
  requireSession,
  sessionSearch,
  sessionsFromRows,
  type EventSearchArgs,
  type SessionSearchArgs,
} from "@/lib/agent/session-query";

export const SESSION_SEARCH = "session_search";
export const SESSION_EVENT_SEARCH = "session_event_search";
export const SESSION_EVENT_READ = "session_event_read";

/** Cuántos vecinos resume `session_event_read` como mucho. DeepSeek no pone
 *  tope; aquí cada evento puede traer un turno entero. */
const MAX_NEIGHBORS = 20;

/** Lo que es distinto aquí, en palabras nuestras (la única frase que no es de
 *  DeepSeek en cada descripción). */
const WHAT_A_SESSION_IS =
  'Here a session is one conversation of this project (the one in progress is "current") and each turn is two events: "user" (what the user wrote) and "assistant" (what you answered, with your actions).';

const STRING_ARRAY = (description: string) => ({ type: "ARRAY", items: { type: "STRING" }, description });
const EVENT_TYPES = {
  type: "ARRAY",
  items: { type: "STRING", enum: ["user", "assistant"] },
  description: "Event types to include.",
};

export const SESSION_QUERY_DECLARATIONS: Record<string, unknown>[] = [
  {
    name: SESSION_SEARCH,
    description: `Search prior sessions in the caller workspace and return the strongest matching event from each session. ${WHAT_A_SESSION_IS}`,
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Literal full-text query over prior session history." },
        session_ids: STRING_ARRAY("Optional session ids to include."),
        created_at_from: { type: "STRING", description: "Inclusive timezone-qualified ISO 8601 creation-time lower bound." },
        created_at_to: { type: "STRING", description: "Inclusive timezone-qualified ISO 8601 creation-time upper bound." },
        event_seq_from: { type: "INTEGER", description: "Inclusive event sequence lower bound." },
        event_seq_to: { type: "INTEGER", description: "Inclusive event sequence upper bound." },
        event_time_from: { type: "STRING", description: "Inclusive timezone-qualified ISO 8601 event-time lower bound." },
        event_time_to: { type: "STRING", description: "Inclusive timezone-qualified ISO 8601 event-time upper bound." },
        event_types: EVENT_TYPES,
      },
      required: ["query"],
    },
  },
  {
    name: SESSION_EVENT_SEARCH,
    description: `Search prior events in one authorized session; the current session excludes the step performing this call. ${WHAT_A_SESSION_IS}`,
    parameters: {
      type: "OBJECT",
      properties: {
        session_id: { type: "STRING", description: "Target session id. Omit for the current session." },
        query: { type: "STRING", description: "Literal full-text query over the target session." },
        seq_from: { type: "INTEGER", description: "Inclusive event sequence lower bound." },
        seq_to: { type: "INTEGER", description: "Inclusive event sequence upper bound." },
        time_from: { type: "STRING", description: "Inclusive timezone-qualified ISO 8601 event-time lower bound." },
        time_to: { type: "STRING", description: "Inclusive timezone-qualified ISO 8601 event-time upper bound." },
        event_types: EVENT_TYPES,
      },
      required: ["query"],
    },
  },
  {
    name: SESSION_EVENT_READ,
    // «Reads» y no el «Read» de DeepSeek: en Len Dynamis (sólo la terminal) una
    // palabra `Read` con mayúscula es una herramienta que no tiene, y su guarda
    // (lib/agent/terminal/declaracion.test.ts) lo prohíbe. Una letra, mismo sentido.
    description: `Reads one full unabridged event and optional neighboring raw-event summaries from an authorized session. ${WHAT_A_SESSION_IS}`,
    parameters: {
      type: "OBJECT",
      properties: {
        session_id: { type: "STRING", description: "Target session id. Omit for the current session." },
        seq: { type: "INTEGER", description: "Target event sequence number." },
        before: { type: "INTEGER", description: "Number of preceding raw events to summarize. Omit for none." },
        after: { type: "INTEGER", description: "Number of following raw events to summarize. Omit for none." },
      },
      required: ["seq"],
    },
  },
];

/** La sección de prompt de DeepSeek (`PROMPT_TEXT` de tool-session-query), sin
 *  las herramientas de `trace` que Len no tiene. */
export const SESSION_QUERY_PROMPT =
  "Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. "
  + "Search results are cursor-free and workspace-scoped. Follow a useful hit with session_event_read when you need exact data.";

const bien = (texto: string): ToolOutcome => ({ response: { ok: true, [CLAVE_TOOL_RESULT]: texto } });
const fallo = (mensaje: string): ToolOutcome => ({ response: { ok: false, error: mensaje, [CLAVE_TOOL_RESULT]: `Error: ${mensaje}` } });
const SIN_CHAT = "searching past conversations isn't available in this environment.";

/** Ejecuta una de las tres; un argumento que no vale vuelve al modelo como
 *  error legible, y lo demás (la base) lo recoge `runAgentTool`. */
async function conLasCharlas(
  session: AgentSession,
  deps: AgentDeps,
  hacer: (sesiones: ReturnType<typeof sessionsFromRows>) => Promise<string> | string,
): Promise<ToolOutcome> {
  if (!deps.chatRows) return fallo(SIN_CHAT);
  try {
    return bien(await hacer(sessionsFromRows(await deps.chatRows(session.projectId))));
  } catch (e) {
    if (e instanceof SessionQueryInputError) return fallo(e.message);
    throw e;
  }
}

export function toolSessionSearch(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return conLasCharlas(session, deps, (s) => sessionSearch(s, args as unknown as SessionSearchArgs));
}

export function toolSessionEventSearch(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return conLasCharlas(session, deps, (s) => eventSearch(s, args as unknown as EventSearchArgs));
}

export function toolSessionEventRead(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return conLasCharlas(session, deps, async (s) => {
    const sessionId = typeof args.session_id === "string" && args.session_id.trim() ? args.session_id.trim() : undefined;
    const seq = args.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) throw new SessionQueryInputError("seq must be a positive integer");
    const vecinos = (v: unknown, nombre: string): number => {
      if (v === undefined) return 0;
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new SessionQueryInputError(`${nombre} must be a non-negative integer`);
      return Math.min(v, MAX_NEIGHBORS);
    };
    const before = vecinos(args.before, "before");
    const after = vecinos(args.after, "after");
    requireSession(s, sessionId);
    const hit = findEvent(s, sessionId, seq);
    if (!hit) throw new SessionQueryInputError(`no event ${seq} in session "${sessionId ?? "current"}"; find one with session_event_search.`);
    // El del asistente trae la transcripción del turno: las llamadas que hizo
    // Len y lo que le contestaron, que es el «dato exacto» de DeepSeek.
    const extra: Record<string, unknown> = {};
    if (hit.event.type === "assistant" && deps.chatTranscript) {
      const t = (await deps.chatTranscript(session.projectId, hit.event.rowId)) as { mensajes?: unknown } | null;
      if (t?.mensajes) extra.transcript = t.mensajes;
    }
    return formatEventRead(hit.session, hit.event, extra, before, after);
  });
}
