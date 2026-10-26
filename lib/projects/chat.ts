// Per-project Chat-tab transcript — append-only log access.
//
// The transcript is an append-only message log (table projectChatMessages):
// a new turn is an INSERT, so concurrent browser tabs editing the same
// project interleave instead of overwriting a shared blob. Callers verify
// project ownership before invoking append/update — see the chat route.

import { and, asc, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { FilaDelHistorial, TranscripcionGuardada } from "@/lib/agent/transcripcion";
import type { ChatRowForSearch } from "@/lib/agent/session-query";
import { parseGoalSnapshot, type GoalSnapshot } from "@/lib/agent/goal";
import { goalActivation } from "@/lib/agent/goal-activation";
import { TODO_WRITE, latestTodosOfActions, type TodoItem } from "@/lib/agent/todo-list";
import { photosForRow, type ChatPhoto } from "@/lib/projects/chat-photos";
import type { AttachedFile } from "@/lib/projects/chat-files";
import { ESTADO_EN_CURSO, storedTurnFromRow } from "@/lib/projects/stored-turn";
import { MAX_MENSAJES_DEL_EQUIPO } from "@/lib/agent/equipo";
import { turnosDeshacibles } from "@/lib/projects/deshacer-turno";
import type { CompactionMark } from "@/lib/agent/compaction/mark";

/** Las columnas de la fila SIN la transcripción (H4): el panel del chat no la
 *  usa, y son los resultados enteros de cada turno. Se calculan al usarse, no
 *  al importar: hay pruebas que simulan un esquema sin esta tabla. Tampoco la
 *  marca de compactación (A11), que lleva el resumen y la cola: de ella el
 *  panel sólo pinta cuántos tokens se resumieron. */
function columnasDelPanel() {
  const { transcript: _transcripcion, compaction: _marca, ...columnas } = getTableColumns(schema.projectChatMessages);
  return {
    ...columnas,
    compactedTokens: sql<number | null>`(${schema.projectChatMessages.compaction}->>'preTokens')::bigint`.mapWith(Number),
  };
}

/** Filas que trae el chat de una vez (A11: ya no es un tope de lo que se guarda;
 *  lo de antes se pide al subir, `getChatMessages` con `before`). */
export const CHAT_LIMIT = 50;

/** A11 · como Claude Code (`cleanupPeriodDays`, 30 por defecto): una charla se
 *  guarda entera 30 días desde su último mensaje, sin tope de filas ni de charlas. */
export const CHAT_RETENTION_DAYS = 30;

// LEN 2.1 · `ESTADO_EN_CURSO` vive con la fila → turno (`stored-turn.ts`, sin
// base: lo usan también las escenas de Len 3.1) y se reexporta desde aquí.
export { ESTADO_EN_CURSO };

/** Load a project's transcript, oldest-first. Ownership is the caller's
 *  responsibility — `getProject` already scoped the project to the user.
 *  A11: the `limit` most recent rows (`CHAT_LIMIT` by default) before the row
 *  `before` (its id); the chat asks for the earlier ones when it reaches the top. */
export async function getChatMessages(
  projectId: string,
  page: { before?: string; limit?: number } = {},
): Promise<StoredChatTurn[]> {
  const t = schema.projectChatMessages;
  // El cursor es la FILA, como el `uuid` de cada mensaje de Claude Code: su hora
  // y, a igual hora, su id. Una hora del navegador (milisegundos) no distingue
  // filas que la base guarda con microsegundos. Una fila que no es de esta
  // charla no trae nada (la comparación con NULL no es cierta).
  const antesDe = page.before
    ? sql`(${t.createdAt}, ${t.id}) < (select c."createdAt", c."id" from "projectChatMessages" c where c."id" = ${page.before} and c."projectId" = ${projectId} and c."conversation" is null)`
    : undefined;
  const [rows, estado] = await Promise.all([
    db
      .select(columnasDelPanel())
      .from(t)
      .where(and(enCurso(projectId), antesDe))
      // Las MÁS RECIENTES (antes la poda dejaba 50 y daba igual por dónde se
      // empezara); se ponen de la más vieja a la más reciente abajo.
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(page.limit ?? CHAT_LIMIT)
      .then((filas) => filas.reverse()),
    // El modo plan y el encargo van en el último turno: una página de antes no lo trae.
    page.before ? Promise.resolve({ planMode: false, goal: null }) : conversationStateOf(projectId),
  ]);
  const turns = await conDeshacibles(projectId, await conAutores(projectId, rows));
  // Piezas 7 y 8: la foto va en el último turno cerrado, que es donde la busca
  // el chat (`lastPlanMode`, el encargo).
  if (estado.planMode || estado.goal) {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.enCurso) continue;
      turns[i] = {
        ...turns[i]!,
        ...(estado.planMode ? { planMode: true as const } : {}),
        ...(estado.goal ? { goal: conActivacion(projectId, estado.goal) } : {}),
      };
      break;
    }
  }
  return turns;
}

/** Las filas cuyo turno aún se puede deshacer en el servidor, marcadas
 *  (`deshacible`). Si la consulta falla, van como antes: sin la marca. */
async function conDeshacibles(projectId: string, turns: StoredChatTurn[]): Promise<StoredChatTurn[]> {
  const aplicados = turns.filter((t) => t.status === "applied" && !t.enCurso && !t.tipo).map((t) => t.id);
  const ids = await turnosDeshacibles(projectId, aplicados).catch(() => new Set<string>());
  return ids.size === 0 ? turns : turns.map((t) => (ids.has(t.id) ? { ...t, deshacible: true as const } : t));
}

/** Las filas, con quién pidió cada turno (compartir el proyecto): `autorId`
 *  si fue un miembro, el dueño si es NULL. Una consulta para todos; si falla,
 *  van sin autor y el chat pinta la inicial de quien mira, como antes. */
async function conAutores(
  projectId: string,
  rows: (Omit<typeof schema.projectChatMessages.$inferSelect, "transcript" | "compaction"> & { compactedTokens: number | null })[],
): Promise<StoredChatTurn[]> {
  const turns = rows.map(storedTurnFromRow);
  if (rows.length === 0) return turns;
  try {
    // Los que pidieron y los mencionados (el chat del equipo): de quien ya no es
    // del proyecto también hace falta el nombre.
    const miembros = [
      ...new Set(rows.flatMap((r) => [r.autorId, ...(r.menciones ?? [])]).filter((x): x is string => Boolean(x))),
    ];
    // UNA consulta, sin `limit`: el dueño del proyecto y los miembros que pidieron algo.
    const gente = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, duenoId: schema.projects.userId })
      .from(schema.projects)
      .innerJoin(
        schema.users,
        or(eq(schema.users.id, schema.projects.userId), miembros.length > 0 ? inArray(schema.users.id, miembros) : undefined),
      )
      .where(eq(schema.projects.id, projectId));
    const duenoId = gente[0]?.duenoId;
    const nombre = new Map(gente.map((u) => [u.id, u.name?.trim() || u.email]));
    return turns.map((t, i) => {
      const autorId = rows[i]!.autorId ?? duenoId ?? undefined;
      const autor = nombre.get(autorId ?? "");
      const nombres = Object.fromEntries(
        (rows[i]!.menciones ?? []).flatMap((id) => (nombre.has(id) ? [[id, nombre.get(id)!]] : [])),
      );
      return {
        ...t,
        ...(autor ? { autor } : {}),
        ...(autorId ? { autorId } : {}),
        ...(Object.keys(nombres).length > 0 ? { nombres } : {}),
      };
    });
  } catch (err) {
    console.warn("[chat] no se pudo leer quién pidió cada turno", err);
    return turns;
  }
}

/** El encargo con la activación de ESTE proceso (tras un reinicio, desarmado). */
function conActivacion(projectId: string, goal: GoalSnapshot): StoredChatTurn["goal"] {
  return { ...goal, activation: goalActivation(projectId, goal.id) };
}

/**
 * PIEZAS 7 Y 8 · EL ESTADO DE LA CHARLA: si sigue en modo plan y su encargo. Lo
 * que pliega el servidor al empezar el turno (`planModeFromRows`,
 * `goalFromRows`): la última fila cerrada CON transcripción. De UNA fila, y es
 * a propósito: leer `transcript->>'planMode'` obliga a Postgres a descomprimir
 * la transcripción entera (hasta `TOPE_TRANSCRIPCION`), y en las 50 filas del
 * panel eran megas en cada carga de proyecto. Si falla, la charla se carga
 * igual, sin los dos: el turno siguiente los dice (`plan`, `goal`).
 */
async function conversationStateOf(projectId: string): Promise<{ planMode: boolean; goal: GoalSnapshot | null }> {
  const t = schema.projectChatMessages;
  try {
    const rows = await db
      .select({
        planMode: sql<string | null>`${t.transcript}->>'planMode'`,
        goal: sql<unknown>`${t.transcript}->'goal'`,
      })
      .from(t)
      .where(and(enCurso(projectId), ne(t.status, ESTADO_EN_CURSO), sql`jsonb_typeof(${t.transcript}) = 'object'`))
      .orderBy(desc(t.createdAt))
      .limit(1);
    return { planMode: rows[0]?.planMode === "true", goal: parseGoalSnapshot(rows[0]?.goal) };
  } catch (err) {
    console.warn("[chat] no se pudo leer el estado de la charla", err);
    return { planMode: false, goal: null };
  }
}

/**
 * PIEZA 8 · QUITAR EL ENCARGO de la charla en curso (`POST /api/agent/encargo`).
 * Lo duradero es la foto de la última fila cerrada con transcripción (la que
 * pliega el servidor), así que se escribe `goal: null` en ESA fila: el pliegue
 * deja de verlo. Comprueba el dueño del proyecto; quien llama comprueba que no
 * corre ningún turno (que al cerrar escribiría su foto).
 */
export async function quitarEncargo(projectId: string, userId: string): Promise<"ok" | "no_encontrado"> {
  const t = schema.projectChatMessages;
  const propio = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  if (!propio[0]) return "no_encontrado";
  const ultima = await db
    .select({ id: t.id })
    .from(t)
    .where(and(enCurso(projectId), ne(t.status, ESTADO_EN_CURSO), sql`jsonb_typeof(${t.transcript}) = 'object'`))
    .orderBy(desc(t.createdAt))
    .limit(1);
  if (ultima[0]) {
    await db
      .update(t)
      .set({ transcript: sql`jsonb_set(${t.transcript}, '{goal}', 'null'::jsonb)` })
      .where(eq(t.id, ultima[0].id));
  }
  return "ok";
}

/** Un turno de Len de la charla en curso que ya es historia: cerrado (un turno
 *  que sigue trabajando no lo es: otra pestaña leería su texto a medias como lo
 *  que Len contestó) y no un mensaje entre personas (lib/projects/chat-equipo.ts:
 *  si los miembros se fueron, siguen en la base y no deben volver a Len). */
function turnoDeLaHistoria(projectId: string) {
  return and(enCurso(projectId), ne(schema.projectChatMessages.status, ESTADO_EN_CURSO), isNull(schema.projectChatMessages.tipo));
}

/** A11 · desde cuándo cuenta el historial: la fila de la ÚLTIMA marca de resumen
 *  (el `compact_boundary` de Claude Code), o `null` = desde el principio. */
async function desdeLaUltimaMarca(projectId: string): Promise<Date | null> {
  const [fila] = await db
    .select({ at: schema.projectChatMessages.createdAt })
    .from(schema.projectChatMessages)
    .where(and(turnoDeLaHistoria(projectId), isNotNull(schema.projectChatMessages.compaction)))
    .orderBy(desc(schema.projectChatMessages.createdAt))
    .limit(1);
  return fila?.at ?? null;
}

/**
 * LA CHARLA ENTERA PARA EL HISTORIAL DEL AGENTE (H4; A11: sin ventana, como
 * Claude Code), de la más vieja a la más reciente, con su transcripción: desde
 * la fila de la última marca de resumen, incluida, o desde el principio. Sale de
 * la base y lo escribió el servidor: nada de aquí lo pone el navegador.
 * Ownership, como arriba, del llamador.
 */
export async function turnosParaElHistorial(projectId: string): Promise<FilaDelHistorial[]> {
  const desde = await desdeLaUltimaMarca(projectId);
  const rows = await db
    .select({
      userText: schema.projectChatMessages.userText,
      assistantReasoning: schema.projectChatMessages.assistantReasoning,
      transcript: schema.projectChatMessages.transcript,
      compaction: schema.projectChatMessages.compaction,
      // La foto del turno sigue en la conversación (`historialDesdeLaBase`).
      attachedImage: schema.projectChatMessages.attachedImage,
      // Y sus PDF (26/10): su nota, y Read los abre (`session.attachments`).
      attachedFiles: schema.projectChatMessages.attachedFiles,
    })
    .from(schema.projectChatMessages)
    .where(and(turnoDeLaHistoria(projectId), desde ? gte(schema.projectChatMessages.createdAt, desde) : undefined))
    .orderBy(asc(schema.projectChatMessages.createdAt));
  return rows.map((r) => ({
    userText: r.userText,
    assistantReasoning: r.assistantReasoning,
    transcript: r.transcript ?? null,
    compaction: r.compaction ?? null,
    attachedImage: r.attachedImage ?? null,
    attachedFiles: r.attachedFiles ?? null,
  }));
}

/**
 * LA ÚLTIMA LISTA DE PROGRESO DE LA CHARLA (spec local 2026-10-15): la de la
 * fila más reciente que tiene una tarjeta de `todo_write`, fuera de la ventana
 * del historial si hace falta. Ni de un turno en curso ni de uno DESHECHO: su
 * trabajo ya no está, y su lista tampoco vale.
 */
export async function latestTodoListForChat(projectId: string): Promise<TodoItem[] | null> {
  const t = schema.projectChatMessages;
  const rows = await db
    .select({ actions: t.actions })
    .from(t)
    .where(
      and(
        enCurso(projectId),
        ne(t.status, ESTADO_EN_CURSO),
        ne(t.status, "reverted"),
        isNull(t.tipo),
        sql`${t.actions} @> ${JSON.stringify([{ tool: TODO_WRITE }])}::jsonb`,
      ),
    )
    .orderBy(desc(t.createdAt))
    .limit(1);
  return rows[0] ? latestTodosOfActions(rows[0].actions) : null;
}

/** Una fila de la charla en curso con lo que hace falta para plegar el equipo. */
export interface FilaCruda {
  readonly tipo: string | null;
  readonly autorId: string | null;
  readonly menciones: string[] | null;
  readonly createdAt: Date;
  readonly fila: FilaDelHistorial;
}

/** Como `turnosParaElHistorial`, con las filas de persona incluidas (el chat del
 *  equipo): desde la última marca de resumen, de la más vieja a la más reciente. */
export async function filasParaElHistorialConEquipo(projectId: string): Promise<FilaCruda[]> {
  const t = schema.projectChatMessages;
  const columnas = {
    tipo: t.tipo,
    autorId: t.autorId,
    menciones: t.menciones,
    createdAt: t.createdAt,
    userText: t.userText,
    assistantReasoning: t.assistantReasoning,
    transcript: t.transcript,
    compaction: t.compaction,
    attachedImage: t.attachedImage,
    attachedFiles: t.attachedFiles,
  };
  // Los turnos de Len, como siempre (`turnosParaElHistorial`): los mensajes del
  // equipo NO cuentan para la marca —si contaran, una charla larga entre
  // personas le quitaría a Len su historial, su modo plan y su encargo—.
  const desdeLaMarca = await desdeLaUltimaMarca(projectId);
  const turnos = await db
    .select(columnas)
    .from(t)
    .where(and(turnoDeLaHistoria(projectId), desdeLaMarca ? gte(t.createdAt, desdeLaMarca) : undefined))
    .orderBy(asc(t.createdAt));
  // Y aparte, los mensajes del equipo desde la marca (los de antes ya van
  // resumidos; sin marca, los de toda la charla), con el tope del sobre.
  const personas = await db
    .select(columnas)
    .from(t)
    .where(and(enCurso(projectId), eq(t.tipo, "persona"), desdeLaMarca ? gte(t.createdAt, desdeLaMarca) : undefined))
    .orderBy(desc(t.createdAt))
    .limit(MAX_MENSAJES_DEL_EQUIPO);
  return [...turnos, ...personas]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({
      tipo: r.tipo ?? null,
      autorId: r.autorId ?? null,
      menciones: r.menciones ?? null,
      createdAt: r.createdAt,
      fila: {
        userText: r.userText,
        assistantReasoning: r.assistantReasoning,
        transcript: r.transcript ?? null,
        compaction: r.compaction ?? null,
        attachedImage: r.attachedImage ?? null,
        attachedFiles: r.attachedFiles ?? null,
      },
    }));
}

/**
 * PIEZA 5 DE LEN 2.5 · las filas del proyecto para buscar en sus charlas
 * (`session_search`, `lib/agent/session-query.ts`): la en curso y las
 * archivadas, de la más vieja a la más reciente, SIN la transcripción — pesa, y
 * sólo hace falta al leer un evento (`transcripcionDeLaFila`). El turno que
 * corre viene con su estado y lo descarta el módulo. Ownership, del llamador.
 */
/** Techo de filas de una búsqueda. Desde A11 lo que se guarda lo acota el tiempo
 *  (`CHAT_RETENTION_DAYS`) y no un número de filas, así que el techo es amplio y
 *  sólo de seguridad. 🔴 Sin `statement_timeout` en la base, y es a propósito: la app
 *  no hace ninguna `db.transaction()` para que los dos conductores (Neon y pg)
 *  sigan intercambiables, y un SET de sesión se quedaría en la conexión del pool.
 *  Lo que la deja sin riesgo es su forma: igualdad por `projectId` (con índice),
 *  sin regex (la lección de la consulta que corrió 17 h) y con este LIMIT. */
const MAX_FILAS_PARA_BUSCAR = 5_000;

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
      tipo: t.tipo,
      autorNombre: schema.users.name,
      autorCorreo: schema.users.email,
    })
    .from(t)
    // EL CHAT DEL EQUIPO: sus mensajes también se buscan —es como Len lee
    // entero lo que el sobre recortó—, con quién los escribió.
    .leftJoin(schema.users, eq(schema.users.id, t.autorId))
    .where(eq(t.projectId, projectId))
    .orderBy(desc(t.createdAt))
    .limit(MAX_FILAS_PARA_BUSCAR);
  // Las más recientes si hubiera de más; el módulo las ordena por fecha.
  return rows.map(({ tipo, autorNombre, autorCorreo, ...r }) => ({
    ...r,
    actions: r.actions ?? null,
    ...(tipo === "persona" ? { equipo: { autor: autorNombre?.trim() || autorCorreo || "someone" } } : {}),
  }));
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

/** Las fotos de un turno del cliente, como se guardan (`photosForRow`). Con
 *  dos o más vienen en `attachedImages`: escribir sólo `attachedImage` pisaría
 *  la lista que la ruta de Len guardó al abrir la fila. */
function fotosDelTurno(turn: Pick<StoredChatTurn, "attachedImage" | "attachedImages">): ChatPhoto | ChatPhoto[] | null {
  return photosForRow(turn.attachedImages ?? (turn.attachedImage ? [turn.attachedImage] : []));
}

/** Append one settled turn. The turn id is the PK, so a retried append is an
 *  idempotent no-op. Then drops the conversations older than CHAT_RETENTION_DAYS (A11). */
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
      attachedImage: fotosDelTurno(turn),
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
        attachedImage: fotosDelTurno(turn),
        assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
        page: turn.page ?? null,
        actions: turn.actions ?? null,
        noDocChange: turn.noDocChange ?? null,
      },
    });
  await pruneOldConversations(projectId);
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
    /** A11: la marca del resumen de este turno (ver `CompactionMark`). Sólo el servidor. */
    compaction?: CompactionMark | null;
    /** Lo que cobró el turno (centicréditos) y lo que tardó. Sólo el servidor
     *  lo sabe; el cierre del turno lo enseña (plans/new-chat/). */
    centicredits?: number | null;
    durationMs?: number | null;
  },
): Promise<void> {
  const toolResults = turn.toolResults ?? null;
  const endReason = turn.endReason ?? null;
  const transcript = turn.transcript ?? null;
  const compaction = turn.compaction ?? null;
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
      compaction,
      centicredits,
      durationMs,
      endReason,
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
      attachedImage: fotosDelTurno(turn),
      assistantReasoning: turn.assistantReasoning.slice(0, 20_000),
      page: turn.page ?? null,
      actions: turn.actions ?? null,
      noDocChange: turn.noDocChange ?? null,
      status: turn.status,
      toolResults,
      transcript,
      compaction,
      centicredits,
      durationMs,
      endReason,
    })
    .onConflictDoUpdate({
      target: schema.projectChatMessages.id,
      set: { toolResults, transcript, compaction, centicredits, durationMs, endReason },
    });
  await pruneOldConversations(projectId);
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
    /** Lo que se guarda tal cual: `photosForRow` (una foto, un objeto). */
    readonly attachedImage?: ChatPhoto | ChatPhoto[] | null;
    /** Los PDF del mensaje (26/10). */
    readonly attachedFiles?: readonly AttachedFile[] | null;
    /** Quién lo pidió, si no fue el dueño (compartir el proyecto). */
    readonly autorId?: string | null;
    /** Pedido con `@Len` desde un hilo del código: de dónde (el chat lo enseña). */
    readonly origen?: { hiloId: string; ruta: string; linea: number } | null;
  },
): Promise<void> {
  await db
    .insert(schema.projectChatMessages)
    .values({
      id: turn.id,
      projectId,
      userText: turn.userText.slice(0, 4000),
      attachedImage: turn.attachedImage ?? null,
      attachedFiles: turn.attachedFiles?.length ? [...turn.attachedFiles] : null,
      autorId: turn.autorId ?? null,
      origen: turn.origen ?? null,
      assistantReasoning: "",
      page: turn.page ?? null,
      status: ESTADO_EN_CURSO,
    })
    .onConflictDoNothing({ target: schema.projectChatMessages.id });
  await pruneOldConversations(projectId);
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
    // Pieza 8: y SU encargo (una fila: una sola transcripción que descomprimir),
    // para que el chat que sigue las rondas sondeando vea cómo va.
    .select({ ...columnasDelPanel(), goal: sql<unknown>`${schema.projectChatMessages.transcript}->'goal'` })
    .from(schema.projectChatMessages)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectChatMessages.projectId))
    .where(
      and(
        eq(schema.projectChatMessages.id, id),
        // El dueño, o un miembro del proyecto (compartir el proyecto, lib/projects/acceso.ts).
        or(
          eq(schema.projects.userId, userId),
          inArray(
            schema.projects.id,
            db.select({ id: schema.projectMembers.projectId }).from(schema.projectMembers).where(eq(schema.projectMembers.userId, userId)),
          ),
        ),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { goal: crudo, ...fila } = row;
  const turn = storedTurnFromRow(fila);
  const goal = parseGoalSnapshot(crudo);
  return goal ? { ...turn, goal: conActivacion(fila.projectId, goal) } : turn;
}

/** A11 · la marca del resumen, en la fila del turno EN CURSO en cuanto el bucle
 *  resume: Claude Code anota el `compact_boundary` en la transcripción en ese
 *  momento, no al final, así que un turno que revienta (o un reinicio) no la
 *  pierde. Una fila ya cerrada no se toca: la escribe su cierre. */
export async function guardarMarcaDelTurno(projectId: string, id: string, compaction: CompactionMark): Promise<void> {
  const t = schema.projectChatMessages;
  await db
    .update(t)
    .set({ compaction })
    .where(and(eq(t.id, id), eq(t.projectId, projectId), eq(t.status, ESTADO_EN_CURSO)));
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

/** A11 · LA RETENCIÓN de Claude Code (`cleanupPeriodDays`): borra entera cada
 *  charla del proyecto —la en curso y cada archivada— cuyo último mensaje tiene
 *  más de `CHAT_RETENTION_DAYS` días. Sustituye a la poda a 50 filas y al tope de
 *  10 archivadas, que borraban lo que Len aún necesitaba para recordar. */
export async function pruneOldConversations(projectId: string, now: Date = new Date()): Promise<void> {
  const corte = new Date(now.getTime() - CHAT_RETENTION_DAYS * 86_400_000);
  const t = schema.projectChatMessages;
  const charla = sql`coalesce(${t.conversation}, '')`;
  await db.delete(t).where(
    and(
      eq(t.projectId, projectId),
      sql`${charla} in (select coalesce(c."conversation", '') from "projectChatMessages" c where c."projectId" = ${projectId} group by coalesce(c."conversation", '') having max(c."createdAt") < ${corte})`,
    ),
  );
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

// ⚰️ `MAX_ARCHIVED_CONVERSATIONS` (10): con A11 las charlas se guardan por
// tiempo (`pruneOldConversations`), no por número.

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
  await pruneOldConversations(projectId);
  return { ok: true, archived: movidas.length > 0 ? id : null };
}

/** Volver a una charla archivada: la pone en curso y archiva la que hubiera. */
export async function reopenConversation(projectId: string, conversation: string): Promise<ConversationChange> {
  if (await hayTurnoEnCurso(projectId)) return { ok: false, reason: "busy" };
  // A11 · la que pasó los 30 días ya no está (como en Claude Code), antes de
  // archivar la de ahora por ella.
  await pruneOldConversations(projectId);
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
  await pruneOldConversations(projectId);
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

/** Las charlas archivadas, de la más reciente a la más vieja. Sin las que pasaron
 *  los `CHAT_RETENTION_DAYS` (A11): se borran con la escritura siguiente. */
export async function listArchivedConversations(projectId: string): Promise<ArchivedConversation[]> {
  const t = schema.projectChatMessages;
  const corte = new Date(Date.now() - CHAT_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: t.conversation,
      // Por sus turnos con Len: los mensajes del equipo (tipo «persona») no
      // titulan ni cuentan; una charla sólo de equipo se titula con el primero.
      title: sql<string>`coalesce((array_agg(${t.userText} ORDER BY ${t.createdAt}) FILTER (WHERE ${t.tipo} IS NULL))[1], (array_agg(${t.userText} ORDER BY ${t.createdAt}))[1])`,
      turns: sql<number>`(count(*) FILTER (WHERE ${t.tipo} IS NULL))::int`,
      startedAt: sql<string>`min(${t.createdAt})`,
      endedAt: sql<string>`max(${t.createdAt})`,
    })
    .from(t)
    .where(and(eq(t.projectId, projectId), sql`${t.conversation} IS NOT NULL`))
    .groupBy(t.conversation)
    .having(sql`max(${t.createdAt}) >= ${corte}`)
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
