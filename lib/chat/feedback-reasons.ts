// lib/chat/feedback-reasons.ts — los motivos de un 👎 y la forma de un voto, sin
// base de datos: lo importan el panel (cliente) y `feedback.ts` (servidor).

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
