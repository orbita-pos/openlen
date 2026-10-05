/**
 * BUSCAR EN LAS CHARLAS DEL PROYECTO — pieza 5 de Len 2.5, con la forma de
 * session-query de DeepSeek (`deepseek-harness` @ 5badb15, MIT,
 * LICENSES/deepseek-harness.MIT.txt: packages/session-query/tool-session-query/
 * src/{index,input,presentation}.ts). Los formatos de salida son los suyos, sin
 * las líneas de padre, disponibilidad y superficie, que Len no tiene.
 *
 * Aquí una SESIÓN es una charla de este proyecto (la en curso es `current`; las
 * archivadas, su id) y cada turno da DOS eventos: `user` (lo que escribió el
 * dueño) y `assistant` (lo que contestó Len, con sus acciones). La búsqueda es de
 * texto LITERAL sin distinguir mayúsculas, como la de DeepSeek («Literal
 * full-text query»): `%` y `_` no son comodines.
 *
 * Puro: las filas llegan de `lib/projects/chat.ts` por `AgentDeps`.
 */

import { goalRoundOf } from "@/lib/agent/goal";

export interface ChatRowForSearch {
  id: string;
  conversation: string | null;
  userText: string;
  assistantReasoning: string;
  actions: { tool: string; status: string; summary: string }[] | null;
  createdAt: Date;
  status: string;
}

export const CURRENT_SESSION = "current";
/** `DEFAULT_MAX_SEARCH_RESULTS` de DeepSeek (tool-session-query/src/index.ts). */
export const DEFAULT_MAX_SEARCH_RESULTS = 100;
/** El turno que está corriendo (`ESTADO_EN_CURSO` de lib/projects/chat.ts). */
const RUNNING = "en_curso";
/** Lote 7-8 (2): los límites del título de respaldo del bundle base de DeepSeek
 *  (`bundle/base/cordis.patch.yml`, `session-title`: `fallbackMaxWords: 5`,
 *  `fallbackMaxBytes: 40`). El que escribe un modelo encima
 *  (`session-title-first-prompt-llm`) cuesta una llamada por charla: no se usa. */
const TITLE_MAX_WORDS = 5;
const TITLE_MAX_BYTES = 40;
/** Los controles que `normalize.ts` de DeepSeek quita de un título. */
const TITLE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‎‏‪-‮⁠-⁤⁦-⁯﻿]/gu;
const SNIPPET_MAX = 160;

export interface SessionEvent {
  seq: number;
  type: "user" | "assistant";
  time: number;
  text: string;
  rowId: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  events: SessionEvent[];
}

/** Un argumento que no vale: la herramienta se lo devuelve al modelo. */
export class SessionQueryInputError extends Error {}

export function sessionsFromRows(rows: readonly ChatRowForSearch[]): Session[] {
  const porCharla = new Map<string, ChatRowForSearch[]>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    // El turno que corre no es historia todavía: no se encuentra a sí mismo.
    if (r.status === RUNNING) continue;
    const id = r.conversation ?? CURRENT_SESSION;
    porCharla.set(id, [...(porCharla.get(id) ?? []), r]);
  }
  return [...porCharla].map(([id, filas]) => ({
    id,
    // Lote 7-8 (2), como el `session-title` de DeepSeek: del primer mensaje
    // HUMANO (una ronda del encargo es `source.kind: 'goal'` allí y no cuenta);
    // sin ninguno, vacío, y se enseña `untitled`.
    title: filas.map((f) => (goalRoundOf(f.userText) ? "" : fallbackTitle(f.userText))).find(Boolean) ?? "",
    createdAt: filas[0]!.createdAt.getTime(),
    events: filas.flatMap((f, i) => {
      const time = f.createdAt.getTime();
      const acciones = (f.actions ?? []).map((a) => `${a.tool}: ${a.summary}`.trim());
      return [
        // Lote 7-8: las rondas del encargo guardan aquí su mensaje de ronda
        // (`<goal_round>…`, en inglés) y se busca ENTERO, como en DeepSeek: allí
        // la ronda es un `user/message` de texto y su búsqueda indexa todo
        // `user/message` sin mirar de dónde viene (session-query/src/extraction.ts).
        { seq: 2 * i + 1, type: "user" as const, time, text: f.userText, rowId: f.id },
        { seq: 2 * i + 2, type: "assistant" as const, time, text: [f.assistantReasoning, ...acciones].filter(Boolean).join("\n"), rowId: f.id },
      ];
    }),
  }));
}

export interface SessionSearchArgs {
  query: string;
  session_ids?: string[];
  created_at_from?: string;
  created_at_to?: string;
  event_seq_from?: number;
  event_seq_to?: number;
  event_time_from?: string;
  event_time_to?: string;
  event_types?: string[];
}

export interface EventSearchArgs {
  session_id?: string;
  query: string;
  seq_from?: number;
  seq_to?: number;
  time_from?: string;
  time_to?: string;
  event_types?: string[];
}

interface Hit {
  event: SessionEvent;
  count: number;
  snippet: string;
}

/** `session_search`: la coincidencia más fuerte de cada sesión (la de más
 *  apariciones; empate, la más reciente). */
export function sessionSearch(sessions: readonly Session[], args: SessionSearchArgs, max = DEFAULT_MAX_SEARCH_RESULTS): string {
  const query = normalizeQuery(args.query);
  const created = timestampRange("created_at", args.created_at_from, args.created_at_to);
  const seq = sequenceRange(args.event_seq_from, args.event_seq_to);
  const time = timestampRange("event_time", args.event_time_from, args.event_time_to);
  const tipos = eventTypes(args.event_types);
  const ids = args.session_ids !== undefined ? nonEmpty("session_ids", args.session_ids) : null;
  const encontradas: { session: Session; best: Hit }[] = [];
  for (const session of sessions) {
    if (ids && !ids.includes(session.id)) continue;
    if (!inRange(session.createdAt, created)) continue;
    const hits = matches(session.events, query, { seq, time, tipos });
    if (hits.length === 0) continue;
    const best = hits.reduce((a, b) => (b.count > a.count || (b.count === a.count && b.event.time >= a.event.time) ? b : a));
    encontradas.push({ session, best });
  }
  if (encontradas.length === 0) return "No prior session matches found.";
  encontradas.sort((a, b) => b.best.count - a.best.count || b.best.event.time - a.best.event.time);
  const items = encontradas.slice(0, max);
  const lines = [`Session search results (${items.length}):`];
  for (const [i, { session, best }] of items.entries()) {
    lines.push(
      "",
      `${i + 1}. Session ${session.id} — ${titleText(session)}`,
      `   Created: ${formatTime(session.createdAt)}`,
      `   Best match: seq ${best.event.seq} | ${best.event.type} | ${formatTime(best.event.time)}`,
      `   Snippet: ${best.snippet}`,
    );
  }
  if (encontradas.length > max) lines.push("", "Result cap reached. Narrow the query or add filters to find additional matches.");
  return lines.join("\n");
}

/** `session_event_search`: los eventos de UNA sesión, en orden. */
export function eventSearch(sessions: readonly Session[], args: EventSearchArgs, max = DEFAULT_MAX_SEARCH_RESULTS): string {
  const query = normalizeQuery(args.query);
  const session = requireSession(sessions, args.session_id);
  const hits = matches(session.events, query, {
    seq: sequenceRange(args.seq_from, args.seq_to),
    time: timestampRange("time", args.time_from, args.time_to),
    tipos: eventTypes(args.event_types),
  });
  const lines = [`Session ${session.id} — ${titleText(session)}`];
  if (hits.length === 0) {
    lines.push("", "No prior event matches found.");
    return lines.join("\n");
  }
  const items = hits.slice(0, max);
  lines.push("", `Event search results (${items.length}):`);
  for (const [i, h] of items.entries()) {
    lines.push(`${i + 1}. seq ${h.event.seq} | ${h.event.type} | ${formatTime(h.event.time)}`, `   Snippet: ${h.snippet}`);
  }
  if (hits.length > max) lines.push("", "Result cap reached. Narrow the query or add filters to find additional matches.");
  return lines.join("\n");
}

export function findEvent(sessions: readonly Session[], sessionId: string | undefined, seq: number): { session: Session; event: SessionEvent } | null {
  const session = sessions.find((s) => s.id === (sessionId ?? CURRENT_SESSION));
  const event = session?.events.find((e) => e.seq === seq);
  return session && event ? { session, event } : null;
}

/** `session_event_read`: el evento entero (con lo que añada quien llama, como
 *  la transcripción del turno) y un resumen de sus vecinos. */
export function formatEventRead(session: Session, event: SessionEvent, extra: Record<string, unknown>, before: number, after: number): string {
  const target = { seq: event.seq, type: event.type, time: formatTime(event.time), text: event.text, ...extra };
  const antes = session.events.filter((e) => e.seq < event.seq && e.seq >= event.seq - Math.max(0, before));
  const despues = session.events.filter((e) => e.seq > event.seq && e.seq <= event.seq + Math.max(0, after));
  const lines = [`Session ${session.id} — ${titleText(session)}`, `Target event seq ${event.seq}:`, "```json", JSON.stringify(target, null, 2), "```"];
  if (antes.length > 0) {
    lines.push("", "Before:");
    for (const e of antes) lines.push(formatNeighbor(e));
  }
  if (despues.length > 0) {
    lines.push("", "After:");
    for (const e of despues) lines.push(formatNeighbor(e));
  }
  return lines.join("\n");
}

/** Una sesión por id (sin id, la en curso); si no existe, error para el modelo. */
export function requireSession(sessions: readonly Session[], sessionId: string | undefined): Session {
  const id = sessionId ?? CURRENT_SESSION;
  const session = sessions.find((s) => s.id === id);
  if (!session) throw new SessionQueryInputError(`no session "${id}" in this project; find one with session_search.`);
  return session;
}

function matches(
  events: readonly SessionEvent[],
  query: string,
  f: { seq: { from?: number; to?: number }; time: { from?: number; to?: number } | undefined; tipos: string[] | null },
): Hit[] {
  const q = query.toLowerCase();
  const out: Hit[] = [];
  for (const event of events) {
    if (f.seq.from !== undefined && event.seq < f.seq.from) continue;
    if (f.seq.to !== undefined && event.seq > f.seq.to) continue;
    if (!inRange(event.time, f.time)) continue;
    if (f.tipos && !f.tipos.includes(event.type)) continue;
    const texto = oneLine(event.text);
    const bajo = texto.toLowerCase();
    const idx = bajo.indexOf(q);
    if (idx < 0) continue;
    out.push({ event, count: bajo.split(q).length - 1, snippet: snippetAround(texto, idx, q.length) });
  }
  return out;
}

function snippetAround(texto: string, idx: number, len: number): string {
  const start = Math.max(0, idx - Math.floor((SNIPPET_MAX - len) / 2));
  const end = Math.min(texto.length, start + SNIPPET_MAX);
  return `${start > 0 ? "…" : ""}${texto.slice(start, end)}${end < texto.length ? "…" : ""}`;
}

function formatNeighbor(event: SessionEvent): string {
  const text = event.text.trim();
  return `- seq ${event.seq} | ${event.type} | ${formatTime(event.time)}` + (text.length === 0 ? " | (no semantic text)" : `\n  ${text.replaceAll("\n", "\n  ")}`);
}

function titleText(session: Session): string {
  // El literal de DeepSeek (`tool-session-query/src/workspace-access.ts`).
  return session.title || "untitled";
}

/**
 * LOTE 7-8 (2) · el título de respaldo de DeepSeek (`session-title/src/
 * normalize.ts`, `fallbackSessionTitle`): sin controles, en una línea, las
 * primeras palabras y como mucho tantos bytes UTF-8, sin partir un carácter.
 */
export function fallbackTitle(text: string): string {
  const palabras = oneLine(text.replace(TITLE_CONTROLS, "")).split(" ").filter(Boolean).slice(0, TITLE_MAX_WORDS);
  const encoder = new TextEncoder();
  let titulo = "";
  let bytes = 0;
  for (const caracter of palabras.join(" ")) {
    const tamano = encoder.encode(caracter).length;
    if (bytes + tamano > TITLE_MAX_BYTES) break;
    titulo += caracter;
    bytes += tamano;
  }
  return titulo.trimEnd();
}

function formatTime(value: number): string {
  return new Date(value).toISOString();
}

function oneLine(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

// ─── Argumentos, como `input.ts` de DeepSeek ─────────────────────────────────

function normalizeQuery(value: unknown): string {
  const query = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (query.length === 0) throw new SessionQueryInputError("session-search query must contain non-whitespace text");
  if (query.includes("\0")) throw new SessionQueryInputError("session-search query must not contain NUL");
  return query;
}

const CON_ZONA = /(Z|[+-]\d{2}:\d{2})$/i;

function timestamp(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (typeof value !== "string" || !CON_ZONA.test(value.trim()) || Number.isNaN(ms)) {
    throw new SessionQueryInputError(`${name} must be a timezone-qualified ISO 8601 timestamp`);
  }
  return ms;
}

function timestampRange(name: string, from: string | undefined, to: string | undefined): { from?: number; to?: number } | undefined {
  const a = timestamp(`${name}_from`, from);
  const b = timestamp(`${name}_to`, to);
  if (a === undefined && b === undefined) return undefined;
  if (a !== undefined && b !== undefined && a > b) throw new SessionQueryInputError(`${name}_from must not be after ${name}_to`);
  return { ...(a !== undefined ? { from: a } : {}), ...(b !== undefined ? { to: b } : {}) };
}

function sequenceRange(from: number | undefined, to: number | undefined): { from?: number; to?: number } {
  for (const [n, v] of [["seq_from", from], ["seq_to", to]] as const) {
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 1)) throw new SessionQueryInputError(`${n} must be a positive integer`);
  }
  if (from !== undefined && to !== undefined && from > to) throw new SessionQueryInputError("seq_from must not be after seq_to");
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

function inRange(value: number, range: { from?: number; to?: number } | undefined): boolean {
  if (!range) return true;
  return (range.from === undefined || value >= range.from) && (range.to === undefined || value <= range.to);
}

function eventTypes(values: string[] | undefined): string[] | null {
  if (values === undefined) return null;
  const tipos = nonEmpty("event_types", values);
  const malos = tipos.filter((t) => t !== "user" && t !== "assistant");
  if (malos.length > 0) throw new SessionQueryInputError(`event_types can only be "user" or "assistant"; got ${malos.join(", ")}`);
  return tipos;
}

function nonEmpty(name: string, values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === "string")) {
    throw new SessionQueryInputError(`${name} must be a non-empty array of strings`);
  }
  return values as string[];
}
