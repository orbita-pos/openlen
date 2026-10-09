// LAS NOTAS DE /.len/memory EN POSTGRES (plans/len-md, tabla `lenMemoryNotes`).
//
// Borrar es suave (`deletedAt`): `rm` de una nota la quita de la vista, y
// escribir otra con el mismo nombre la revive en la misma fila. Sin historial
// de cambios, como Claude Code: lo que Len toca se ve en la tarjeta del chat.
import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { serializeNote, type MemoryNote, type NoteType } from "./note";

export type StoredNote = MemoryNote & { readonly updatedAt: Date; readonly authorId: string | null };

/** Las notas vivas del proyecto, de la más nueva a la más vieja (el orden del índice). */
export async function listNotes(projectId: string): Promise<StoredNote[]> {
  const rows = await db
    .select({
      name: schema.lenMemoryNotes.name,
      type: schema.lenMemoryNotes.type,
      description: schema.lenMemoryNotes.description,
      body: schema.lenMemoryNotes.body,
      updatedAt: schema.lenMemoryNotes.updatedAt,
      authorId: schema.lenMemoryNotes.authorId,
    })
    .from(schema.lenMemoryNotes)
    .where(and(eq(schema.lenMemoryNotes.projectId, projectId), isNull(schema.lenMemoryNotes.deletedAt)))
    .orderBy(desc(schema.lenMemoryNotes.updatedAt));
  return rows.map((r) => ({ ...r, type: r.type as NoteType }));
}

async function liveNote(projectId: string, name: string): Promise<MemoryNote | null> {
  const rows = await db
    .select({
      name: schema.lenMemoryNotes.name,
      type: schema.lenMemoryNotes.type,
      description: schema.lenMemoryNotes.description,
      body: schema.lenMemoryNotes.body,
    })
    .from(schema.lenMemoryNotes)
    .where(
      and(
        eq(schema.lenMemoryNotes.projectId, projectId),
        eq(schema.lenMemoryNotes.name, name),
        isNull(schema.lenMemoryNotes.deletedAt),
      ),
    )
    .limit(1);
  const r = rows[0];
  return r ? { ...r, type: r.type as NoteType } : null;
}

/** Crea o sustituye la nota (y la revive si estaba borrada). `before` = cómo estaba viva. */
export async function upsertNote(projectId: string, note: MemoryNote, authorId: string | null): Promise<{ before: string | null }> {
  const previa = await liveNote(projectId, note.name);
  const now = new Date();
  await db
    .insert(schema.lenMemoryNotes)
    .values({ projectId, name: note.name, type: note.type, description: note.description, body: note.body, authorId })
    .onConflictDoUpdate({
      target: [schema.lenMemoryNotes.projectId, schema.lenMemoryNotes.name],
      set: { type: note.type, description: note.description, body: note.body, authorId, updatedAt: now, deletedAt: null },
    });
  return { before: previa ? serializeNote(previa) : null };
}

/** Borrado suave. `before` = cómo estaba viva, o `null` si no había. */
export async function deleteNote(projectId: string, name: string): Promise<{ before: string | null }> {
  const previa = await liveNote(projectId, name);
  if (!previa) return { before: null };
  await db
    .update(schema.lenMemoryNotes)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.lenMemoryNotes.projectId, projectId),
        eq(schema.lenMemoryNotes.name, name),
        isNull(schema.lenMemoryNotes.deletedAt),
      ),
    );
  return { before: serializeNote(previa) };
}
