// EL MODO PLAN EN EL CHAT (pieza 7 de Len 2.5). La ficha «Plan» del compositor
// enseña lo que el chat sabe del servidor (`known`: el último turno cerrado, y
// los eventos `plan` del turno en vuelo) y, encima, lo que el dueño eligió y
// aún no ha mandado (`wanted`). Al servidor sólo viaja la elección —como el
// `/plan` de DeepSeek, que es un evento y no un estado—: una copia vieja del
// estado (un turno reenganchado no trae eventos) apagaría el modo plan que Len
// encendió mientras el chat no miraba. Puro.

import type { QuestionAnswer, UserQuestion } from "@/lib/agent/ask-user-question";
import { APPROVE_LABEL, KEEP_PLANNING_LABEL, PLAN_FIRST_LABEL, SKIP_PLANNING_LABEL, consentGiven, reviewOutcome } from "@/lib/agent/plan-mode";
import type { StoredChatTurn } from "@/lib/projects/types";

/** El modo plan del último turno cerrado (uno que sigue en el servidor aún no
 *  tiene su foto). */
export function lastPlanMode(turns: readonly StoredChatTurn[]): boolean {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (!t.enCurso) return t.planMode === true;
  }
  return false;
}

/** Tocar la ficha (o la opción del «+»): lo contrario de lo que se ve; si eso
 *  es lo que ya era, no queda nada que mandar. */
export function togglePlanSelection(o: { wanted: boolean | null; known: boolean }): boolean | null {
  const next = !(o.wanted ?? o.known);
  return next === o.known ? null : next;
}

/** Contestar la tarjeta cuando el turno ya cerró es la puerta del dueño: aceptar
 *  entrar lo enciende y aprobar el plan lo apaga. Lo demás no cambia nada. */
export function planModeAfterAnswer(questions: readonly UserQuestion[], answers: readonly QuestionAnswer[]): boolean | null {
  const kind = questions[0]?.intent?.kind;
  if (kind === "plan-consent") return consentGiven(answers) ? true : null;
  if (kind === "plan-review") return reviewOutcome(answers).approved ? false : null;
  return null;
}

/** Las etiquetas canónicas del modo plan (las que lee el servidor) y las claves
 *  de sus textos en el chat (`panelsChat`). Sólo valen en una pregunta con
 *  `intent`: la etiqueta «Approve» de una pregunta del modelo es suya. */
export const PLAN_LABEL_KEYS: Readonly<Record<string, { label: string; hint: string }>> = {
  [APPROVE_LABEL]: { label: "newChat.plan.approve", hint: "newChat.plan.approveHint" },
  [KEEP_PLANNING_LABEL]: { label: "newChat.plan.keep", hint: "newChat.plan.keepHint" },
  [PLAN_FIRST_LABEL]: { label: "newChat.plan.planFirst", hint: "newChat.plan.planFirstHint" },
  [SKIP_PLANNING_LABEL]: { label: "newChat.plan.skip", hint: "newChat.plan.skipHint" },
};

/** Las respuestas a una tarjeta del modo plan para el MENSAJE que sale cuando el
 *  turno ya cerró: con las etiquetas en el idioma del dueño (es su burbuja, y
 *  Len lo lee igual). A una pregunta del modelo, ni se tocan. */
export function planAnswersForMessage(
  questions: readonly UserQuestion[],
  answers: QuestionAnswer[],
  t: (key: string) => string,
): QuestionAnswer[] {
  if (!questions[0]?.intent) return answers;
  return answers.map((a) => ({ ...a, selected: a.selected.map((x) => (PLAN_LABEL_KEYS[x] ? t(PLAN_LABEL_KEYS[x].label) : x)) }));
}
