// WHAT WAITS FOR THE PERSON at the end of a turn: one rule for the scheduled-task email
// (`deliver.ts`) and the phone's «Tareas · Te necesita» (`lib/movil/tasks-overview.ts`, spec local
// 2026-10-31-len-movil, §6), so the two never disagree. Pure: no server code.
import { asksTheOwner } from "@/lib/agent/ask-user-question";
import type { StoredChatTurn } from "@/lib/projects/types";

type Cards = NonNullable<StoredChatTurn["actions"]>;

/** Cards that leave the turn waiting for the person, beyond a question: their summary says what. */
const WAITS_FOR_THE_PERSON = new Set(["publish", "exit_plan_mode", "request_secrets", "connect_email_domain"]);

/** What waits for the person in OpenLen: unanswered questions, and the cards above. */
export function waitingFrom(cards: Cards): string[] {
  const out: string[] = [];
  for (const card of cards) {
    if (asksTheOwner(card.tool) && !card.respuesta) {
      const questions = (card.preguntas ?? []).map((p) => p.question).filter(Boolean);
      out.push(...(questions.length > 0 ? questions : [card.pregunta ?? card.summary]));
    } else if (WAITS_FOR_THE_PERSON.has(card.tool)) {
      out.push(card.summary);
    }
  }
  return [...new Set(out.map((s) => s?.trim()).filter((s): s is string => Boolean(s)))];
}
