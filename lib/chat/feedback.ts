// lib/chat/feedback.ts — ¿TE SIRVIÓ? El 👍/👎 de un turno del chat, con motivos.
//
// Decisión de Jesús (03/10, plans/new-chat/): se construye y se guarda, ligado
// al turno, para leerlo después. Uno por turno y persona: votar otra vez lo
// cambia; quitar el voto lo borra. Ownership del proyecto, del llamador.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Los motivos de un 👎, como códigos: la frase la pone el cliente en su
 *  idioma. Un 👍 no lleva motivos. */
export const FEEDBACK_REASONS = ["made_up", "not_what_i_asked", "touched_other", "looks_bad", "too_slow"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export type FeedbackRating = "up" | "down";

/** Tope de la nota libre. */
export const FEEDBACK_NOTE_MAX = 1000;

export interface TurnFeedback {
  readonly rating: FeedbackRating;
  readonly reasons: readonly FeedbackReason[];
  readonly note: string | null;
}

export function isFeedbackReason(x: unknown): x is FeedbackReason {
  return typeof x === "string" && (FEEDBACK_REASONS as readonly string[]).includes(x);
}

/** Vota (o cambia el voto) de un turno. */
export async function saveTurnFeedback(
  projectId: string,
  userId: string,
  turnId: string,
  f: TurnFeedback,
): Promise<void> {
  const reasons = f.rating === "down" ? [...new Set(f.reasons.filter(isFeedbackReason))] : [];
  const note = f.note?.trim() ? f.note.trim().slice(0, FEEDBACK_NOTE_MAX) : null;
  await db
    .insert(schema.chatTurnFeedback)
    .values({ projectId, userId, turnId, rating: f.rating, reasons, note })
    .onConflictDoUpdate({
      target: [schema.chatTurnFeedback.turnId, schema.chatTurnFeedback.userId],
      set: { rating: f.rating, reasons, note, updatedAt: new Date() },
    });
}

/** Quita el voto de un turno. */
export async function removeTurnFeedback(projectId: string, userId: string, turnId: string): Promise<void> {
  await db
    .delete(schema.chatTurnFeedback)
    .where(
      and(
        eq(schema.chatTurnFeedback.projectId, projectId),
        eq(schema.chatTurnFeedback.userId, userId),
        eq(schema.chatTurnFeedback.turnId, turnId),
      ),
    );
}

/** Los votos de esta persona en este proyecto, por turno. */
export async function listTurnFeedback(projectId: string, userId: string): Promise<Record<string, TurnFeedback>> {
  const rows = await db
    .select({
      turnId: schema.chatTurnFeedback.turnId,
      rating: schema.chatTurnFeedback.rating,
      reasons: schema.chatTurnFeedback.reasons,
      note: schema.chatTurnFeedback.note,
    })
    .from(schema.chatTurnFeedback)
    .where(and(eq(schema.chatTurnFeedback.projectId, projectId), eq(schema.chatTurnFeedback.userId, userId)));
  const out: Record<string, TurnFeedback> = {};
  for (const r of rows) {
    if (r.rating !== "up" && r.rating !== "down") continue;
    out[r.turnId] = { rating: r.rating, reasons: (r.reasons ?? []).filter(isFeedbackReason), note: r.note };
  }
  return out;
}
