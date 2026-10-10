/**
 * LEN POR CORREO — los correos a Len, en la base (`lenEmailRequests`). Primero se
 * apuntan, luego se trabaja: un correo repetido no lanza otro turno, y un
 * reinicio no pierde lo que quedó a medias (`resumeEmailRequests`).
 */
import "server-only";

import { createHash } from "node:crypto";

import { and, asc, count, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export interface EmailRequest {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly sender: string;
  readonly subject: string;
  readonly texto: string;
  readonly idioma: string;
  readonly inReplyTo: string | null;
  readonly respuesta: string | null;
  readonly createdAt: Date;
}

/** El Message-ID identifica el correo; sin él, una huella de lo que trae. */
export function dedupeKeyOf(mail: { messageId?: string | null; sender: string; to: string; subject: string; text: string }): string {
  const id = mail.messageId?.trim();
  if (id) return `mid:${id.toLowerCase()}`;
  return `sha:${createHash("sha256").update([mail.sender, mail.to, mail.subject, mail.text].join("\u0000")).digest("hex")}`;
}

/** Lo apunta. `null` = ya estaba: el mismo correo entregado otra vez. */
export async function recordEmailRequest(r: Omit<EmailRequest, "id" | "respuesta" | "createdAt"> & { dedupeKey: string }): Promise<EmailRequest | null> {
  const [row] = await db
    .insert(schema.lenEmailRequests)
    .values({ ...r })
    .onConflictDoNothing({ target: schema.lenEmailRequests.dedupeKey })
    .returning();
  return row ?? null;
}

/** Cuántos correos a Len recibió el proyecto en la última hora. */
export async function recentEmailRequests(projectId: string, now = new Date()): Promise<number> {
  const t = schema.lenEmailRequests;
  const [r] = await db
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.projectId, projectId), gte(t.createdAt, new Date(now.getTime() - 3_600_000))));
  return Number(r?.n ?? 0);
}

/** Lo que Len dijo, guardado ANTES de mandarlo. */
export async function saveEmailReply(id: string, respuesta: string): Promise<void> {
  await db.update(schema.lenEmailRequests).set({ respuesta }).where(eq(schema.lenEmailRequests.id, id));
}

export async function markEmailReplied(id: string): Promise<void> {
  await db.update(schema.lenEmailRequests).set({ contestadoAt: new Date() }).where(eq(schema.lenEmailRequests.id, id));
}

/** Los correos de antes de `before` aún sin contestar, y si su turno llegó a
 *  empezar (su fila del chat existe: el turno la abre al arrancar). */
export async function unansweredEmailRequests(before: Date): Promise<(EmailRequest & { started: boolean })[]> {
  const t = schema.lenEmailRequests;
  const rows = await db
    .select({
      id: t.id,
      projectId: t.projectId,
      userId: t.userId,
      sender: t.sender,
      subject: t.subject,
      texto: t.texto,
      idioma: t.idioma,
      inReplyTo: t.inReplyTo,
      respuesta: t.respuesta,
      createdAt: t.createdAt,
      // Con la tabla escrita: `${t.id}` sale como `"id"` a secas, y dentro de la
      // subconsulta sería el `id` del chat (siempre igual a sí mismo).
      started: sql<boolean>`exists (select 1 from "projectChatMessages" c where c."id" = "lenEmailRequests"."id")`,
    })
    .from(t)
    .where(and(isNull(t.contestadoAt), lt(t.createdAt, before)))
    .orderBy(asc(t.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, started: Boolean(r.started) }));
}
