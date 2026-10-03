"use client";

// EL CIERRE DEL TURNO, EN UNA LÍNEA (plans/new-chat/, revisión del 03/10):
// «✨ Aplicado · 5 ediciones · Deshacer   26 s · 1,2 créditos   👍 👎».
//
// Las DECISIONES son las del chat de hoy, no se repiten aquí con otra forma:
//   · si hay Deshacer, `planDeUndo` (la misma llamada que lo ejecuta);
//   · «No cambió nada de la página» cuando el servidor dice que no cambió
//     (`noDocChange`), aunque Len diga «Listo ✅»: es un hecho, no un juicio;
//   · ámbar —nunca rojo— si se cortó DESPUÉS de cambiar algo: rojo mandaría a
//     repetirlo y aplicarlo dos veces;
//   · un Deshacer que el servidor rechaza no afirma nada: el cambio sigue.
// Lo nuevo es la línea: el tiempo y lo que costó (los manda el servidor), y el
// 👍/👎.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Clock, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";

import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";
import { duracionLegible } from "@/lib/workspace-v2/proceso-del-turno";
import type { FeedbackReason, TurnFeedback } from "@/lib/chat/feedback-reasons";
import { planDeUndo } from "../panels/undo-turn";
import { editsOfTurn } from "./turn-changes";
import { FeedbackButtons, FeedbackForm } from "./turn-feedback";
import type { DesignTurn } from "./use-agent-chat";

/** Los créditos del turno en el idioma de quien lee («1,18» en español, «1.18»
 *  en inglés). `formatCredits` escribe siempre con punto, y la línea del cierre
 *  va en el idioma del usuario. */
export function creditsIn(locale: string, centicredits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(centicredits / CENTICREDITOS_POR_CREDITO);
}

export function TurnClose({
  turn,
  currentPage,
  vote,
  onUndo,
  onRetry,
  onRate,
  onClearRate,
}: {
  turn: DesignTurn;
  currentPage: string | null;
  vote: TurnFeedback | undefined;
  onUndo: (turn: DesignTurn) => void;
  onRetry: (turn: DesignTurn) => void;
  onRate: (rating: "up" | "down", reasons?: readonly FeedbackReason[], note?: string | null) => void;
  onClearRate: () => void;
}) {
  const t = useTranslations("panelsChat");
  const tAgent = useTranslations("wsPage.agent");
  const locale = useLocale();
  const [form, setForm] = useState(false);
  const [thanks, setThanks] = useState(false);

  if (turn.status === "streaming") return null;

  if (turn.status === "error") {
    return (
      <div className="nc-notice-bad nc-up flex items-start gap-2 rounded-[9px] px-2.5 py-1.5 text-[12px] leading-snug">
        <X size={14} className="mt-px shrink-0" />
        <span className="min-w-0 flex-1 break-words">{turn.errorText ?? t("errors.generic")}</span>
        <button type="button" onClick={() => onRetry(turn)} className="shrink-0 font-semibold underline">
          {t("error.retry")}
        </button>
      </div>
    );
  }

  const durationMs =
    turn.durationMs ??
    (turn.startedAt !== undefined && turn.appliedAt !== undefined && turn.appliedAt >= turn.startedAt
      ? turn.appliedAt - turn.startedAt
      : null);
  const stats = [
    durationMs !== null ? duracionLegible(durationMs, locale) : null,
    typeof turn.centicredits === "number"
      ? t("newChat.close.credits", { credits: creditsIn(locale, turn.centicredits) })
      : null,
  ].filter((x): x is string => x !== null);

  const up = () => {
    if (vote?.rating === "up") return onClearRate();
    onRate("up");
    setForm(false);
    setThanks(true);
    window.setTimeout(() => setThanks(false), 2400);
  };
  const down = () => {
    if (vote?.rating === "down" && !form) return onClearRate();
    onRate("down", vote?.rating === "down" ? vote.reasons : [], vote?.rating === "down" ? vote.note : null);
    setThanks(false);
    setForm(true);
  };

  const plan = turn.status === "applied" && !turn.noDocChange ? planDeUndo(turn, currentPage) : null;
  const edits = editsOfTurn(turn);
  // CORTADO a medias (tras cambiar algo): «se cortó antes de terminar…». Un
  // aviso SIN corte —el tope o la conversación que no cabe— no se cortó: se
  // dice tal cual, sin la plantilla (el turno sí terminó su cierre).
  const notice = turn.cortado
    ? t("cutShort", { reason: turn.avisoTurno || tAgent("errors.cancelled") })
    : turn.avisoTurno || null;

  return (
    <div className="space-y-1.5">
      <div className="nc-up flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-lg border bd bg-elev px-2 py-[3px] text-[11.5px] fg-muted">
          {turn.status === "reverted" ? (
            <>
              <RotateCcw size={12} className="text-[var(--accent)]" />
              {t("reverted")}
            </>
          ) : turn.noDocChange ? (
            t("noChange.label")
          ) : (
            <>
              <Sparkles size={12} className="text-[var(--accent)]" />
              {edits > 0 ? t("newChat.close.appliedEdits", { count: edits }) : t("newChat.close.applied")}
              {plan?.kind === "restaurar" && (
                <button
                  type="button"
                  onClick={() => onUndo(turn)}
                  disabled={turn.undoEnCurso === true}
                  className="font-semibold text-[var(--accent-strong)] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {turn.undoEnCurso ? t("applied.undoing") : t("applied.undo")}
                </button>
              )}
            </>
          )}
        </span>
        {stats.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] tabular-nums fg-faint">
            <Clock size={12} />
            {stats.join(" · ")}
          </span>
        )}
        {thanks && <span className="text-[11.5px] fg-faint">{t("newChat.feedback.thanks")}</span>}
        <FeedbackButtons vote={vote} onUp={up} onDown={down} />
      </div>
      {plan?.kind === "imposible" && plan.motivo === "otra-pagina" && (
        <p className="text-[11.5px] leading-snug fg-faint">{t("applied.otherPage")}</p>
      )}
      {notice && (
        <div className="nc-notice-warn flex items-start gap-2 rounded-[9px] px-2.5 py-1.5 text-[12px] leading-snug">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1 break-words">{notice}</span>
        </div>
      )}
      {turn.undoFallo && (
        <div className="nc-notice-bad flex items-start gap-2 rounded-[9px] px-2.5 py-1.5 text-[12px] leading-snug">
          <X size={14} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            {turn.undoFallo.motivo === "red"
              ? t("undo.failedNetwork")
              : turn.undoFallo.motivo === "respuesta"
                ? t("undo.failedResponse")
                : t("undo.failedHttp", { status: turn.undoFallo.status })}
          </span>
        </div>
      )}
      {form && (
        <FeedbackForm
          initial={vote}
          onSend={(reasons, note) => {
            onRate("down", reasons, note);
            setForm(false);
            setThanks(true);
            window.setTimeout(() => setThanks(false), 2400);
          }}
          onCancel={() => setForm(false)}
        />
      )}
    </div>
  );
}
