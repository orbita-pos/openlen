// Per-project Chat-tab transcript — append-only log access.
//
// The transcript is an append-only message log (table projectChatMessages):
// a new turn is an INSERT, so concurrent browser tabs editing the same
// project interleave instead of overwriting a shared blob. Callers verify
// project ownership before invoking append/update — see the chat route.

import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { FilaDelHistorial, TranscripcionGuardada } from "@/lib/agent/transcripcion";
import type { ChatRowForSearch } from "@/lib/agent/session-query";

/** Las columnas de la fila SIN la transcripción (H4): el panel del chat no la
 *  usa, y son los resultados enteros de cada turno. Se calculan al usarse, no
 *  al importar: hay pruebas que simulan un esquema sin esta tabla. */
function columnasDelPanel() {
  const { transcript: _transcripcion, ...columnas } = getTableColumns(schema.projectChatMessages);
  return columnas;
}

/** Filas que se guardan por proyecto (`appendChatMessage` poda el resto). */
export const CHAT_LIMIT = 50;

/** LEN 2.1 · el turno sigue trabajando en el servidor. Es texto en la base, como
 *  `cortado`: no hace falta migración. Lo escribe y lo cierra SÓLO el servidor. */
export const ESTADO_EN_CURSO = "en_curso";

/** Load a project's transcript, oldest-first. Ownership is the caller's
 *  responsibility — `getProject` already scoped the project to the user. */
export async function getChatMessages(
  projectId: string,
): Promise<StoredChatTurn[]> {
  const [rows, planMode] = await Promise.all([
    db
      .select(columnasDelPanel())
      .from(schema.projectChatMessages)
      .where(enCurso(projectId))
      .orderBy(asc(schema.projectChatMessages.createdAt))
      .limit(CHAT_LIMIT),
    planModeOfConversation(projectId),
  ]);
  const turns = rows.map(rowToTurn);
  // Pieza 7: la foto va en el último turno cerrado, que es donde la busca el
  // chat (`lastPlanMode`).
  if (planMode) {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.enCurso) continue;
      turns[i] = { ...turns[i]!, planMode: true };
      break;
    }
  }
  return turns;
}

/**
 * PIEZA 7 · ¿sigue la charla en modo plan? Lo que pliega el servidor al empezar
 * el turno (`planModeFromRows`): la última fila cerrada CON transcripción. De UNA
 * fila, y es a propósito: leer `transcript->>'planMode'` obliga a Postgres a
 * descomprimir la transcripción entera (hasta `TOPE_TRANSCRIPCION`), y en las
 * 50 filas del panel eran megas en cada carga de proyecto. Si falla, la charla
 * se carga igual, sin modo plan: el turno siguiente lo dice (`plan`).
 */
async function planModeOfConversation(projectId: string): Promise<boolean> {
  const t = schema.projectChatMessages;
  try {
    const rows = await db
      .select({ planMode: sql<string | null>`${t.transcript}->>'planMode'` })
      .from(t)
      .where(and(enCurso(projectId), ne(t.status, ESTADO_EN_CURSO), sql`jsonb_typeof(${t.transcript}) = 'object'`))
      .orderBy(desc(t.createdAt))
      .limit(1);
    return rows[0]?.planMode === "true";
  } catch (err) {
    console.warn("[chat] no se pudo leer el modo plan de la charla", err);
    return false;
  }
}

/**
 * LOS ÚLTIMOS TURNOS PARA EL HISTORIAL DEL AGENTE (H4), del más viejo al más
 * reciente, con su transcripción. Sale de la base y lo escribió el servidor:
 * nada de aquí lo pone el navegador. Ownership, como arriba, del llamador.
 */
export async function turnosParaElHistorial(projectId: string, cuantos: number): Promise<FilaDelHistorial[]> {
  const rows = await db
    .select({
      userText: schema.projectChatMessages.userText,
      assistantReasoning: schema.projectChatMessages.assistantReasoning,
      transcript: schema.projectChatMessages.transcript,
      // La foto del turno sigue en la conversación (`historialDesdeLaBase`).
      attachedImage: schema.projectChatMessages.attachedImage,
    })
    .from(schema.projectChatMessages)
    // Un turno que sigue trabajando no es historia todavía: si otra pestaña
    // manda un turno mientras tanto, no puede leer el texto a medias de éste
    // como si fuera lo que Len contestó.
    .where(
      and(
        enCurso(projectId),
        ne(schema.projectChatMessages.status, ESTADO_EN_CURSO),
      ),
    )
    .orderBy(desc(schema.projectChatMessages.createdAt))
    .limit(cuantos);
  return rows.reverse().map((r) => ({
    userText: r.userText,
    assistantReasoning: r.assistantReasoning,
    transcript: r.transcript ?? null,
    attachedImage: r.attachedImage ?? null,
  }));
}

/**
 * PIEZA 5 DE LEN 2.5 · las filas del proyecto para buscar en sus charlas
 * (`session_search`, `lib/agent/session-query.ts`): la en curso y las
 * archivadas, de la más vieja a la más reciente, SIN la transcripción — pesa, y
 * sólo hace falta al leer un evento (`transcripcionDeLaFila`). El turno que
 * corre viene con su estado y lo descarta el módulo. Ownership, del llamador.
 */
/** Techo de filas de una búsqueda: la charla en curso (`CHAT_LIMIT`) y las
 *  archivadas que se guardan (`MAX_ARCHIVED_CONVERSATIONS`), de `CHAT_LIMIT` cada
 *  una como mucho. 🔴 Sin `statement_timeout` en la base, y es a propósito: la app
 *  no hace ninguna `db.transaction()` para que los dos conductores (Neon y pg)
 *  sigan intercambiables, y un SET de sesión se quedaría en la conexión del pool.
 *  Lo que la deja sin riesgo es su forma: igualdad por `projectId` (con índice),
 *  sin regex (la lección de la consulta que corrió 17 h) y con este LIMIT. Se
 *  calcula al llamar: `MAX_ARCHIVED_CONVERSATIONS` se declara más abajo. */
const maxFilasParaBuscar = () => CHAT_LIMIT * (MAX_ARCHIVED_CONVERSATIONS + 1);

export async function filasParaBuscar(projectId: string): Promise<ChatRowForSearch[]> {
  const t = schema.projectChatMessages;
  const rows = await db
    .select({
      id: t.id,
      conversation: t.conversation,
      userText: t.userText,
      assistantReasoning: t.assistantReasoning,
      actions: t.actions,
      createdAt: t.createdAt,
      status: t.status,
    })
    .from(t)
    .where(eq(t.projectId, projectId))
    .orderBy(desc(t.createdAt))
    .limit(maxFilasParaBuscar());
  // Las más recientes si hubiera de más; el módulo las ordena por fecha.
  return rows.map((r) => ({ ...r, actions: r.actions ?? null }));
}

/** La transcripción de UNA fila del proyecto, para `session_event_read`. */
export async function transcripcionDeLaFila(projectId: string, id: string): Promise<TranscripcionGuardada | null> {
  const t = schema.projectChatMessages;
  const rows = await db
    .select({ transcript: t.transcript })
    .from(t)
    .where(and(eq(t.projectId, projectId), eq(t.id, id)))
    .limit(1);
  return rows[0]?.transcript ?? null;
}

/** Append one settled turn. The turn id is the PK, so a retried append is an
 *  idempotent no-op. Trims the project's log to the most-recent CHAT_LIMIT. */
export async function appendChatMessage(
  projectId: string,
  turn: StoredChatTurn,
): Promise<void> {
  await db
    .insert(schema.projectChatMessages)
    .values({
      id: turn.id,
      projectId,
      userText: turn.userText.slice(0, 4000),
      attachedImage: turn.attachedImage ?? null,
      assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
      page: turn.page ?? null,
      actions: turn.actions ?? null,
      noDocChange: turn.noDocChange ?? null,
      status: turn.status === "reverted" ? "reverted" : "applied",
    })
    // ANTES ERA `onConflictDoNothing`, y con el registro del servidor eso se
    // convertía en una CARRERA: los dos escriben al cerrar el stream, y si
    // ganaba el servidor se perdían el texto y las tarjetas del cliente (que
    // los tiene más completos); si ganaba el cliente se perdía el diario.
    // Cada uno actualiza SUS columnas y el orden deja de importar.
    //
    // `status` NO está en el set a propósito: lo pone el insert y lo mueve
    // `updateChatMessageStatus` (Deshacer). Reescribirlo aquí resucitaría un
    // turno ya revertido si alguna vez hubiera un reintento de append.
    // `toolResults` tampoco: es del servidor.
    .onConflictDoUpdate({
      target: schema.projectChatMessages.id,
      set: {
        userText: turn.userText.slice(0, 4000),
        attachedImage: turn.attachedImage ?? null,
        assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
        page: turn.page ?? null,
        actions: turn.actions ?? null,
        noDocChange: turn.noDocChange ?? null,
      },
    });
  await trim(projectId);
}

/**
 * EL SERVIDOR REGISTRA EL TURNO. Lo llama `app/api/agent/route.ts` desde su
 * `finally`, o sea SIEMPRE — también cuando el turno revienta, que es
 * justamente el que hoy se perdía entero.
 *
 * 🔴 POR QUÉ NO ES `appendChatMessage`. Ése lo llama el NAVEGADOR al terminar
 * de leer el stream: si el socket muere fuera de banda, no llega nunca y el
 * turno desaparece aunque sus cambios ya vivan en la base. La vara es
 * Claude Code, que escribe cada entrada de su transcripción desde el proceso
 * que corre el bucle, entrada a entrada — nunca desde la vista.
 *
 * CONVIVEN A PROPÓSITO, y sin pisarse:
 *  · Fila nueva (el cliente no llegó) → se inserta lo que el servidor tiene.
 *  · Fila ya puesta por el cliente → se actualiza SÓLO `toolResults`. Las
 *    tarjetas y el texto los sigue escribiendo el cliente, que los tiene más
 *    completos; el diario no lo tiene nadie más. Sin esto habría una carrera
 *    —los dos escriben al cerrar el stream— y el ganador decidiría si el
 *    motivo del fallo se guarda o se pierde.
 */
export async function registrarTurnoDelServidor(
  projectId: string,
  turn: Omit<StoredChatTurn, "status"> & {
    /** `cortado` sólo lo escribe el servidor: ver `corteDelTurno`. */
    status: StoredChatTurn["status"] | "cortado";
    toolResults?: { tool: string; ok?: boolean; respuesta: Record<string, unknown> }[] | null;
    /** H4: lo que vio el modelo. Como el diario, SÓLO lo escribe el servidor. */
    transcript?: TranscripcionGuardada | null;
    /** Lo que cobró el turno (centicréditos) y lo que tardó. Sólo el servidor
     *  lo sabe; el cierre del turno lo enseña (plans/new-chat/). */
    centicredits?: number | null;
    durationMs?: number | null;
  },
): Promise<void> {
  const toolResults = turn.toolResults ?? null;
  const transcript = turn.transcript ?? null;
  const centicredits = enteroONulo(turn.centicredits);
  const durationMs = enteroONulo(turn.durationMs);
  // LEN 2.1 · LA FILA EN CURSO SE CIERRA ENTERA. La abrió este mismo servidor
  // al empezar (`abrirFilaDelTurno`), así que aquí no hay carrera con el
  // cliente: la ruta cierra la fila ANTES de mandar el `done`, y el cliente
  // escribe su versión (con el aviso en su idioma) después. Sólo si sigue en
  // curso: un turno ya cerrado —o una fila que no se llegó a abrir— cae al
  // camino de siempre, de abajo.
  const cerradas = await db
    .update(schema.projectChatMessages)
    .set({
      userText: turn.userText.slice(0, 4000),
      assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
      actions: turn.actions ?? null,
      noDocChange: turn.noDocChange ?? null,
      status: turn.status,
      toolResults,
      transcript,
      centicredits,
      durationMs,
    })
    .where(
      and(
        eq(schema.projectChatMessages.id, turn.id),
        eq(schema.projectChatMessages.projectId, projectId),
        eq(schema.projectChatMessages.status, ESTADO_EN_CURSO),
      ),
    )
    .returning({ id: schema.projectChatMessages.id });
  if (cerradas.length > 0) return;
  await db
    .insert(schema.projectChatMessages)
    .values({
      id: turn.id,
      projectId,
      userText: turn.userText.slice(0, 4000),
      attachedImage: turn.attachedImage ?? null,
      assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
      page: turn.page ?? null,
      actions: turn.actions ?? null,
      noDocChange: turn.noDocChange ?? null,
      status: turn.status,
      toolResults,
      transcript,
      centicredits,
      durationMs,
    })
    .onConflictDoUpdate({
      target: schema.projectChatMessages.id,
      set: { toolResults, transcript, centicredits, durationMs },
    });
  await trim(projectId);
}

/**
 * LEN 2.1 · LA FILA DEL TURNO SE ABRE AL EMPEZAR, en curso.
 *
 * Hasta aquí la fila se escribía al final (en el `finally` de la ruta y cuando
 * el navegador terminaba de leer). Desde que el turno no muere con el cliente,
 * quien vuelve a mirarlo —otra pestaña, el móvil, la misma tras perder la red—
 * necesita encontrarlo MIENTRAS trabaja. `avanceDelTurno` la va llenando y
 * `registrarTurnoDelServidor` la cierra.
 *
 * Idempotente por la clave: un reintento con el mismo id no hace nada.
 */
export async function abrirFilaDelTurno(
  projectId: string,
  turn: {
    readonly id: string;
    readonly userText: string;
    readonly page: string | null;
    readonly attachedImage?: { url: string; alt?: string } | null;
  },
): Promise<void> {
  await db
    .insert(schema.projectChatMessages)
    .values({
      id: turn.id,
      projectId,
      userText: turn.userText.slice(0, 4000),
      attachedImage: turn.attachedImage ?? null,
      assistantReasoning: "",
      page: turn.page ?? null,
      status: ESTADO_EN_CURSO,
    })
    .onConflictDoNothing({ target: schema.projectChatMessages.id });
  await trim(projectId);
}

/** Lo que el turno lleva: su texto y sus tarjetas. Sólo si la fila SIGUE en
 *  curso — un avance que llegue tarde no puede reabrir un turno cerrado. */
export async function avanceDelTurno(
  projectId: string,
  id: string,
  avance: { readonly userText: string; readonly assistantReasoning: string; readonly actions: StoredChatTurn["actions"] },
): Promise<void> {
  await db
    .update(schema.projectChatMessages)
    .set({
      userText: avance.userText.slice(0, 4000),
      assistantReasoning: avance.assistantReasoning.slice(0, 20_000),
      actions: avance.actions ?? null,
    })
    .where(
      and(
        eq(schema.projectChatMessages.id, id),
        eq(schema.projectChatMessages.projectId, projectId),
        eq(schema.projectChatMessages.status, ESTADO_EN_CURSO),
      ),
    );
}

/** Un turno que no produjo nada (ni texto, ni tarjetas, ni cambios) no merece
 *  fila —la regla de siempre, `hayAlgo`—; la que se abrió al empezar se quita. */
export async function quitarFilaDelTurno(projectId: string, id: string): Promise<void> {
  await db
    .delete(schema.projectChatMessages)
    .where(
      and(
        eq(schema.projectChatMessages.id, id),
        eq(schema.projectChatMessages.projectId, projectId),
        eq(schema.projectChatMessages.status, ESTADO_EN_CURSO),
      ),
    );
}

/**
 * UN TURNO DE ESTE USUARIO, por el id de su fila, sin la transcripción. Para
 * el reenganche (`GET /api/agent/turno/<fila>`), que lo pide cada pocos
 * segundos: una consulta, sin cargar el proyecto entero. La fila de otro no
 * existe (se cruza con `projects.userId`).
 */
export async function leerTurnoDelUsuario(
  id: string,
  userId: string,
): Promise<StoredChatTurn | null> {
  const rows = await db
    .select(columnasDelPanel())
    .from(schema.projectChatMessages)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectChatMessages.projectId))
    .where(and(eq(schema.projectChatMessages.id, id), eq(schema.projects.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row ? rowToTurn(row) : null;
}

/** Una fila que se quedó en curso sin nadie que la corra (el servidor se
 *  reinició a mitad, y su `finally` no llegó) pasa a cortada. Sólo si sigue en
 *  curso: si el turno la cerró entre medias, manda lo suyo. */
export async function marcarCortadaSiSigueEnCurso(id: string): Promise<void> {
  await db
    .update(schema.projectChatMessages)
    .set({ status: "cortado" })
    .where(and(eq(schema.projectChatMessages.id, id), eq(schema.projectChatMessages.status, ESTADO_EN_CURSO)));
}

/** Flip a turn's status — the Undo path (applied → reverted). Scoped by
 *  projectId so a turn id from another project can't be touched. */
export async function updateChatMessageStatus(
  projectId: string,
  turnId: string,
  status: "applied" | "reverted",
): Promise<void> {
  await db
    .update(schema.projectChatMessages)
    .set({ status })
    .where(
      and(
        eq(schema.projectChatMessages.id, turnId),
        eq(schema.projectChatMessages.projectId, projectId),
      ),
    );
}

/** Evict the oldest rows beyond the cap — mirrors projectVersions' trim. Sólo
 *  la charla en curso: las archivadas tienen su propio tope
 *  (`MAX_ARCHIVED_CONVERSATIONS`) y no se recortan con cada turno nuevo. */
async function trim(projectId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.projectChatMessages.id })
    .from(schema.projectChatMessages)
    .where(enCurso(projectId))
    .orderBy(desc(schema.projectChatMessages.createdAt));
  if (rows.length <= CHAT_LIMIT) return;
  const excess = rows.slice(CHAT_LIMIT).map((r) => r.id);
  await db
    .delete(schema.projectChatMessages)
    .where(inArray(schema.projectChatMessages.id, excess));
}

function rowToTurn(
  row: Omit<typeof schema.projectChatMessages.$inferSelect, "transcript">,
): StoredChatTurn {
  const turn: StoredChatTurn = {
    id: row.id,
    userText: row.userText,
    assistantReasoning: row.assistantReasoning,
    status: row.status === "reverted" ? "reverted" : "applied",
    // The row's createdAt doubles as the turn's applied-at timestamp.
    appliedAt: row.createdAt.getTime(),
  };
  if (row.attachedImage) turn.attachedImage = row.attachedImage;
  if (row.page) turn.page = row.page; // NULL stays undefined = home
  // F2-T11: NULL/absent stays undefined on both — restoreTurn (chat-panel.tsx)
  // treats undefined exactly like a pre-F2 row (no cards, "Applied" verb ok).
  if (row.actions && row.actions.length > 0) turn.actions = row.actions;
  if (row.noDocChange) turn.noDocChange = true;
  // Un turno que se CORTÓ a medias se lee como aplicado —lo que hizo, hecho
  // está— con la marca que lo distingue. Ver `corteDelTurno`.
  if (row.status === "cortado") turn.cortado = true;
  // Len 2.1: el turno sigue trabajando en el servidor. Ver `ESTADO_EN_CURSO`.
  if (row.status === ESTADO_EN_CURSO) turn.enCurso = true;
  // Lo que cobró y tardó, si el servidor lo apuntó (plans/new-chat/).
  if (typeof row.centicredits === "number") turn.centicredits = row.centicredits;
  if (typeof row.durationMs === "number") turn.durationMs = row.durationMs;
  return turn;
}

function enteroONulo(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Las filas de la charla EN CURSO del proyecto: `conversation` NULL. */
function enCurso(projectId: string) {
  return and(eq(schema.projectChatMessages.projectId, projectId), isNull(schema.projectChatMessages.conversation));
}

// ─────────────────────────────────────────────────────────────────────────────
// LAS CHARLAS (plans/new-chat/, «Empezar de cero», decisión de Jesús 03/10).
//
// Empezar de cero ARCHIVA la charla en curso, no la borra: sus filas reciben un
// id de charla y dejan de leerse (panel, historial del modelo, lente Terminal).
// Volver a una archivada la pone otra vez en curso y archiva la que hubiera, en
// UNA sentencia: nunca hay un momento con dos charlas en curso ni con ninguna.
// La memoria de Len y las notas de la página NO se tocan: son del usuario y de
// la página, no de la charla (como CLAUDE.md sobrevive a un `/clear`).
// ─────────────────────────────────────────────────────────────────────────────

/** Charlas archivadas que se guardan por proyecto; las más viejas se borran. */
export const MAX_ARCHIVED_CONVERSATIONS = 10;

export type ConversationChange =
  | { readonly ok: true; readonly archived: string | null }
  | { readonly ok: false; readonly reason: "busy" | "not_found" };

/** ¿Hay un turno trabajando en la charla en curso? Mientras lo haya, no se
 *  cambia de charla: el turno escribiría su fila en una charla que ya no se ve. */
async function hayTurnoEnCurso(projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projectChatMessages.id })
    .from(schema.projectChatMessages)
    .where(and(enCurso(projectId), eq(schema.projectChatMessages.status, ESTADO_EN_CURSO)))
    .limit(1);
  return rows.length > 0;
}

/** «Empezar de cero»: archiva la charla en curso. `archived` es su id, o null
 *  si no había nada que archivar. Ownership, del llamador. */
export async function startNewConversation(projectId: string): Promise<ConversationChange> {
  if (await hayTurnoEnCurso(projectId)) return { ok: false, reason: "busy" };
  const id = crypto.randomUUID();
  const movidas = await db
    .update(schema.projectChatMessages)
    .set({ conversation: id })
    .where(enCurso(projectId))
    .returning({ id: schema.projectChatMessages.id });
  await trimArchived(projectId);
  return { ok: true, archived: movidas.length > 0 ? id : null };
}

/** Volver a una charla archivada: la pone en curso y archiva la que hubiera. */
export async function reopenConversation(projectId: string, conversation: string): Promise<ConversationChange> {
  if (await hayTurnoEnCurso(projectId)) return { ok: false, reason: "busy" };
  const c = schema.projectChatMessages.conversation;
  const existe = await db
    .select({ id: schema.projectChatMessages.id })
    .from(schema.projectChatMessages)
    .where(and(eq(schema.projectChatMessages.projectId, projectId), eq(c, conversation)))
    .limit(1);
  if (existe.length === 0) return { ok: false, reason: "not_found" };
  const antes = await db
    .select({ id: schema.projectChatMessages.id })
    .from(schema.projectChatMessages)
    .where(enCurso(projectId))
    .limit(1);
  const nueva = crypto.randomUUID();
  // UNA sentencia: la en curso pasa a archivada y la elegida a en curso a la vez.
  await db
    .update(schema.projectChatMessages)
    .set({ conversation: sql`CASE WHEN ${c} IS NULL THEN ${nueva} ELSE NULL END` })
    .where(and(eq(schema.projectChatMessages.projectId, projectId), sql`(${c} IS NULL OR ${c} = ${conversation})`));
  await trimArchived(projectId);
  return { ok: true, archived: antes.length > 0 ? nueva : null };
}

export interface ArchivedConversation {
  readonly id: string;
  /** El primer mensaje del usuario: el título de la charla. */
  readonly title: string;
  readonly turns: number;
  readonly startedAt: number;
  readonly endedAt: number;
}

/** Las charlas archivadas, de la más reciente a la más vieja. */
export async function listArchivedConversations(projectId: string): Promise<ArchivedConversation[]> {
  const t = schema.projectChatMessages;
  const rows = await db
    .select({
      id: t.conversation,
      title: sql<string>`(array_agg(${t.userText} ORDER BY ${t.createdAt}))[1]`,
      turns: sql<number>`count(*)::int`,
      startedAt: sql<string>`min(${t.createdAt})`,
      endedAt: sql<string>`max(${t.createdAt})`,
    })
    .from(t)
    .where(and(eq(t.projectId, projectId), sql`${t.conversation} IS NOT NULL`))
    .groupBy(t.conversation)
    .orderBy(sql`max(${t.createdAt}) DESC`);
  const out: ArchivedConversation[] = [];
  for (const r of rows) {
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      title: (r.title ?? "").slice(0, 200),
      turns: Number(r.turns),
      startedAt: new Date(r.startedAt).getTime(),
      endedAt: new Date(r.endedAt).getTime(),
    });
  }
  return out;
}

/** Se guardan las `MAX_ARCHIVED_CONVERSATIONS` archivadas más recientes. */
async function trimArchived(projectId: string): Promise<void> {
  const charlas = await listArchivedConversations(projectId);
  const sobran = charlas.slice(MAX_ARCHIVED_CONVERSATIONS).map((c) => c.id);
  if (sobran.length === 0) return;
  await db
    .delete(schema.projectChatMessages)
    .where(
      and(
        eq(schema.projectChatMessages.projectId, projectId),
        inArray(schema.projectChatMessages.conversation, sobran),
      ),
    );
}


/** ¿Es este proyecto de este usuario? Las rutas de las charlas y del 👍/👎 lo
 *  preguntan antes de tocar nada (la misma consulta que `ownsProject` de la
 *  ruta del chat). */
export async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
