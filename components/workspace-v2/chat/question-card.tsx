"use client";

// LA PREGUNTA DE LEN, DESTACADA (plans/new-chat/). Cuando Len llama a
// `preguntar` el turno TERMINA y te toca: la pregunta sale en su propia tarjeta,
// que brilla hasta que contestas (abajo, con tus palabras: `preguntar` no trae
// opciones, y dárselas cambiaría lo que lee Len). Contestada, se encoge a una
// línea: «Respondiste: 48 horas» (revisión del 03/10).

import { useTranslations } from "next-intl";
import { Check, HelpCircle } from "lucide-react";

export function QuestionCard({ question, answer }: { question: string; answer: string | null }) {
  const t = useTranslations("panelsChat");
  if (answer !== null) {
    return (
      <div
        className="nc-up flex min-w-0 items-center gap-2 rounded-[10px] border bd bg-elev px-2.5 py-1.5 text-[12px] fg-muted"
        title={question}
      >
        <Check size={13} className="nc-ok shrink-0" />
        <span className="min-w-0 truncate">{t("newChat.question.answered", { answer: firstLine(answer) })}</span>
      </div>
    );
  }
  return (
    <div className="nc-ask px-3.5 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--nc-accent-text)]">
        <HelpCircle size={13} />
        {t("newChat.question.label")}
      </div>
      {question ? (
        <p className="m-0 whitespace-pre-wrap break-words text-[13.5px] font-semibold leading-snug fg">{question}</p>
      ) : null}
      <p className="mt-1.5 text-[11.5px] fg-muted">{t("newChat.question.hint")}</p>
    </div>
  );
}

function firstLine(s: string): string {
  const line = s.split("\n")[0]?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/** El texto de Len sin la pregunta al final, si la pregunta va en su tarjeta:
 *  el bucle la añade al texto cuando Len no la escribió (`loop.ts`), y
 *  enseñarla dos veces es ruido. */
export function withoutTrailingQuestion(text: string, question: string | null): string {
  if (!question) return text;
  const trimmed = text.trimEnd();
  return trimmed.endsWith(question) ? trimmed.slice(0, trimmed.length - question.length).trimEnd() : text;
}
