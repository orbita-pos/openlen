// CONTESTAR A LEN DESDE LA TARJETA (pieza 3 de Len 2.5). Mientras el turno
// espera (`ask_user_question`, 120 s), la respuesta vuelve a ESE turno por
// `POST /api/agent/responder` y Len sigue. Si ya nadie espera —venció la espera,
// el turno cerró, o la tarjeta es de una fila vieja—, la respuesta se manda como
// un mensaje normal y abre el turno siguiente: nunca se pierde. Puro.

import { RECOMMENDED_SUFFIX, type QuestionAnswer, type UserQuestion } from "@/lib/agent/ask-user-question";

const textoDe = (a: QuestionAnswer | undefined): string =>
  a ? [...a.selected.map((s) => s.replace(RECOMMENDED_SUFFIX, "")), ...(a.custom ? [a.custom] : [])].join(", ") : "";

/** La respuesta como mensaje: una pregunta, su respuesta sola; varias, cada una
 *  con su pregunta delante, para que Len sepa qué contesta cada línea. */
export function composeAnswerMessage(questions: readonly UserQuestion[], answers: readonly QuestionAnswer[]): string {
  const porId = new Map(answers.map((a) => [a.id, a]));
  if (questions.length <= 1) return textoDe(porId.get(questions[0]?.id ?? "") ?? answers[0]);
  return questions
    .map((q) => ({ q, texto: textoDe(porId.get(q.id)) }))
    .filter(({ texto }) => texto)
    .map(({ q, texto }) => `${q.question} ${texto}`)
    .join("\n");
}

/** Cuándo sale la respuesta como mensaje normal. Con un turno todavía en vuelo
 *  (el que preguntó, cerrándose justo al vencer la espera), `send()` la tiraría
 *  sin decir nada: espera a que acabe y sale entonces, como los mensajes en cola
 *  de Claude Code. */
export function fallbackDelivery(busy: boolean): "now" | "after-turn" {
  return busy ? "after-turn" : "now";
}

export type ResponderOutcome = "answered" | "ignore" | "fallback";

/** Qué hacer con lo que contestó `POST /api/agent/responder`. */
export function outcomeOfResponder(status: number, code: string | undefined): ResponderOutcome {
  if (status >= 200 && status < 300) return "answered";
  // Ya contestada (doble clic, otra pestaña): la primera ganó.
  if (status === 409 && code === "ya_respondida") return "ignore";
  return "fallback";
}
