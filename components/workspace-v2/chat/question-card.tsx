"use client";

// LA PREGUNTA DE LEN, DESTACADA (plans/new-chat/). Desde la pieza 3 de Len 2.5
// es `ask_user_question` de DeepSeek: una o varias preguntas, con opciones
// (etiqueta + una frase, la recomendada primero), varias a la vez y «otra» con
// tus palabras. La tarjeta brilla hasta que contestas; contestada, se encoge a
// una línea: «Respondiste: 48 horas» (revisión del 03/10).
//
// Lo memorable es UN TOQUE: con una sola pregunta de una sola respuesta, tocar
// la opción contesta. Lo demás se manda con «Responder». Sin quien conteste (una
// fila vieja de `preguntar`), queda la pista de contestar abajo, como antes.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, HelpCircle } from "lucide-react";

import { RECOMMENDED_SUFFIX, type QuestionAnswer, type UserQuestion } from "@/lib/agent/ask-user-question";

type Translate = (key: string, values?: Record<string, string>) => string;

export interface QuestionCardProps {
  /** La pregunta como texto plano: la de una fila vieja, o la de siempre. */
  question: string;
  /** Las preguntas con sus opciones (pieza 3). Sin ellas, se pinta `question`. */
  questions?: readonly UserQuestion[] | null;
  /** Lo que contestó el dueño: con él, la tarjeta se encoge a una línea. */
  answer: string | null;
  /** Quien recibe la respuesta. Sin él, no hay botones: se contesta abajo. */
  onAnswer?: (answers: QuestionAnswer[]) => void;
}

export function QuestionCard(props: QuestionCardProps) {
  const t = useTranslations("panelsChat");
  return <QuestionCardView {...props} t={(key, values) => t(key as never, values as never)} />;
}

export function QuestionCardView({ question, questions, answer, onAnswer, t }: QuestionCardProps & { t: Translate }) {
  const [elegidas, setElegidas] = useState<Record<string, string[]>>({});
  const [libres, setLibres] = useState<Record<string, string>>({});
  const [otraAbierta, setOtraAbierta] = useState<Record<string, boolean>>({});
  const [enviada, setEnviada] = useState(false);

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

  const lista: readonly UserQuestion[] = questions?.length ? questions : question ? [{ id: "q1", question }] : [];
  const contestable = Boolean(onAnswer) && !enviada;
  const unToque = lista.length === 1 && !lista[0]!.multiSelect && (lista[0]!.options?.length ?? 0) > 0;

  const mandar = (answers: QuestionAnswer[]) => {
    if (!onAnswer || enviada) return;
    setEnviada(true);
    onAnswer(answers);
  };
  const respuestas = (): QuestionAnswer[] =>
    lista.map((q) => {
      const custom = (libres[q.id] ?? "").trim();
      return { id: q.id, selected: elegidas[q.id] ?? [], ...(custom ? { custom } : {}) };
    });
  const completa = lista.length > 0 && respuestas().every((r) => r.selected.length > 0 || Boolean(r.custom));

  const elegir = (q: UserQuestion, label: string) => {
    if (!contestable) return;
    if (unToque) {
      mandar([{ id: q.id, selected: [label] }]);
      return;
    }
    setElegidas((prev) => {
      const ya = prev[q.id] ?? [];
      const siguiente = q.multiSelect ? (ya.includes(label) ? ya.filter((x) => x !== label) : [...ya, label]) : [label];
      return { ...prev, [q.id]: siguiente };
    });
    // Elegir una opción en una de una sola respuesta cierra «otra».
    if (!q.multiSelect) setOtraAbierta((prev) => ({ ...prev, [q.id]: false }));
  };

  // El botón de mandar sólo hace falta cuando un toque no basta.
  const hayCampo = lista.some((q) => !q.options?.length || otraAbierta[q.id]);
  const conBoton = contestable && (!unToque || hayCampo);

  return (
    <div className="nc-ask px-3.5 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--nc-accent-text)]">
        <HelpCircle size={13} />
        {t("newChat.question.label")}
      </div>
      <div className="flex flex-col gap-3">
        {lista.map((q) => {
          const elegidasDeEsta = elegidas[q.id] ?? [];
          const conOpciones = (q.options?.length ?? 0) > 0;
          return (
            <div key={q.id} className="flex min-w-0 flex-col gap-1.5">
              {q.header ? <span className="text-[11px] font-medium fg-muted">{q.header}</span> : null}
              <p className="m-0 whitespace-pre-wrap break-words text-[13.5px] font-semibold leading-snug fg">{q.question}</p>
              {q.multiSelect && contestable ? <span className="text-[11px] fg-muted">{t("newChat.question.pickMany")}</span> : null}
              {conOpciones && (
                <div role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question} className="flex flex-col gap-1">
                  {q.options!.map((o) => {
                    const recomendada = RECOMMENDED_SUFFIX.test(o.label);
                    const marcada = elegidasDeEsta.includes(o.label);
                    return (
                      <button
                        key={o.label}
                        type="button"
                        role={q.multiSelect ? "checkbox" : "radio"}
                        aria-checked={marcada}
                        disabled={!contestable}
                        onClick={() => elegir(q, o.label)}
                        className="nc-opt"
                      >
                        <span className="nc-opt-mark" data-multi={q.multiSelect ? "true" : "false"} aria-hidden="true">
                          {marcada && q.multiSelect ? <Check size={10} strokeWidth={3} /> : null}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5 text-left">
                          <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium fg">
                            {o.label.replace(RECOMMENDED_SUFFIX, "")}
                            {recomendada ? <span className="nc-opt-rec">{t("newChat.question.recommended")}</span> : null}
                          </span>
                          {o.description ? <span className="text-[11.5px] leading-snug fg-muted">{o.description}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                  {contestable && !otraAbierta[q.id] ? (
                    <button
                      type="button"
                      onClick={() => setOtraAbierta((prev) => ({ ...prev, [q.id]: true }))}
                      className="self-start rounded-md px-1 py-0.5 text-[12px] font-medium text-[var(--nc-accent-text)] hover:underline focus-visible:outline focus-visible:outline-2"
                    >
                      {t("newChat.question.other")}
                    </button>
                  ) : null}
                </div>
              )}
              {contestable && (!conOpciones || otraAbierta[q.id]) ? (
                <textarea
                  rows={1}
                  value={libres[q.id] ?? ""}
                  onChange={(e) => {
                    const valor = e.currentTarget.value;
                    setLibres((prev) => ({ ...prev, [q.id]: valor }));
                    // Lo escrito en una de una sola respuesta sustituye a la opción.
                    if (!q.multiSelect && valor.trim()) setElegidas((prev) => ({ ...prev, [q.id]: [] }));
                  }}
                  placeholder={t("newChat.question.otherPlaceholder")}
                  aria-label={q.question}
                  className="nc-opt-input"
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {conBoton ? (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            disabled={!completa}
            onClick={() => mandar(respuestas())}
            className="rounded-full bg-[var(--accent-strong)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("newChat.question.send")}
          </button>
        </div>
      ) : null}
      {!onAnswer ? <p className="mt-1.5 text-[11.5px] fg-muted">{t("newChat.question.hint")}</p> : null}
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
