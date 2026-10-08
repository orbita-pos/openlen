// EL CHAT DEL EQUIPO (docs/superpowers/specs/2026-10-07-chat-del-equipo-design.md):
// un mensaje entre personas del proyecto es una fila más de la conversación,
// con `tipo = "persona"` y sin respuesta de Len, como un mensaje entre personas
// en un canal de Claude Tag. Lo ve todo el proyecto y Len lo lee como contexto
// (lib/agent/equipo.ts). Ownership y permisos, del llamador.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { MAX_TEXTO_DEL_HILO, mencionesValidas, personasDelProyecto } from "@/lib/projects/hilos";
import { trim } from "@/lib/projects/chat";
import { MAX_PHOTOS_PER_MESSAGE, photosForRow, type ChatPhoto } from "@/lib/projects/chat-photos";

export const TIPO_PERSONA = "persona";

export async function escribirMensajeDelEquipo(p: {
  projectId: string;
  autorId: string;
  texto: string;
  menciones: readonly string[];
  /** Las fotos adjuntas, como las de un turno (`photosForRow`). */
  fotos?: readonly ChatPhoto[];
}): Promise<{ id: string; mencionados: string[] }> {
  const mencionados = mencionesValidas(p.menciones, await personasDelProyecto(p.projectId), p.autorId);
  const id = crypto.randomUUID();
  await db.insert(schema.projectChatMessages).values({
    id,
    projectId: p.projectId,
    userText: p.texto.slice(0, MAX_TEXTO_DEL_HILO),
    assistantReasoning: "",
    status: "applied",
    tipo: TIPO_PERSONA,
    // El autor, siempre explícito (también el dueño): el color y el sobre lo leen.
    autorId: p.autorId,
    menciones: mencionados,
    attachedImage: photosForRow((p.fotos ?? []).slice(0, MAX_PHOTOS_PER_MESSAGE)),
  });
  if (mencionados.length > 0) {
    await db.insert(schema.projectChatMentions).values(mencionados.map((userId) => ({ projectId: p.projectId, mensajeId: id, userId })));
  }
  // La charla tiene tope (`CHAT_LIMIT`) como con cada turno de Len: sin podar,
  // la fila 51 no se vería en el chat.
  await trim(p.projectId);
  return { id, mencionados };
}

/** Un turno con `@Len` que además menciona a alguien: la fila guarda a quién, y cada uno lo tiene sin ver. */
export async function apuntarMencionesDelTurno(p: { projectId: string; filaId: string; mencionados: readonly string[] }): Promise<void> {
  if (p.mencionados.length === 0) return;
  await db.update(schema.projectChatMessages).set({ menciones: [...p.mencionados] }).where(eq(schema.projectChatMessages.id, p.filaId));
  await db.insert(schema.projectChatMentions).values(p.mencionados.map((userId) => ({ projectId: p.projectId, mensajeId: p.filaId, userId })));
}

export async function mencionesDelChatSinVer(projectId: string, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectChatMentions)
    .where(and(eq(schema.projectChatMentions.projectId, projectId), eq(schema.projectChatMentions.userId, userId), isNull(schema.projectChatMentions.vistaAt)));
  return r?.n ?? 0;
}

export async function marcarChatVisto(projectId: string, userId: string): Promise<void> {
  await db
    .update(schema.projectChatMentions)
    .set({ vistaAt: new Date() })
    .where(and(eq(schema.projectChatMentions.projectId, projectId), eq(schema.projectChatMentions.userId, userId), isNull(schema.projectChatMentions.vistaAt)));
}

/** LA FIRMA DE LA CONVERSACIÓN EN CURSO, para que un chat compartido abierto la
 *  relea sólo si cambió (y no el proyecto entero cada 10 s): cuántas filas, la
 *  más nueva, y cuántas siguen en curso o están deshechas —un turno que termina
 *  o se deshace cambia la firma sin añadir filas—. */
export async function firmaDelChat(projectId: string): Promise<string> {
  const t = schema.projectChatMessages;
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      ultima: sql<string | null>`max(${t.createdAt})::text`,
      enCurso: sql<number>`(count(*) filter (where ${t.status} = 'en_curso'))::int`,
      deshechas: sql<number>`(count(*) filter (where ${t.status} = 'reverted'))::int`,
    })
    .from(t)
    .where(and(eq(t.projectId, projectId), isNull(t.conversation)));
  return `${r?.n ?? 0}:${r?.ultima ?? ""}:${r?.enCurso ?? 0}:${r?.deshechas ?? 0}`;
}

/** El nombre visible (o el correo) de cada usuario, para quien ya no está en el
 *  proyecto pero sigue en la charla: el sobre de Len lo nombra igual. */
export async function nombresDeUsuarios(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, [...ids]));
  return new Map(rows.map((u) => [u.id, u.name?.trim() || u.email]));
}

/** ¿Tiene el proyecto algún miembro? UNA consulta barata, para que un turno en
 *  un proyecto sin miembros (casi todos) no pida las personas para nada. */
export async function proyectoCompartido(projectId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, projectId))
    .limit(1);
  return Boolean(r);
}
