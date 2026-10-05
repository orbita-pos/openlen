"use client";

// LA TARJETA DEL ENCARGO (pieza 8 de Len 2.5), encima del compositor: lo que
// enseña el `/goal` de DeepSeek al consultarlo —el objetivo, la ronda, si sigue
// solo, está en pausa o se atascó y por qué— con sus dos controles del dueño:
// «Reanudar» (un turno: la ronda siguiente) y «Quitar» (`/goal clear`). Oculta
// sin encargo o completo: el cierre de Len ya contó lo hecho.

import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";

import { goalCard, type GoalView } from "./goal-state";

export function GoalCardView({
  goal,
  busy,
  stoppedForCredits,
  onResume,
  onClear,
}: {
  goal: GoalView | null;
  /** Un turno trabajando (de este encargo u otro): los controles esperan. */
  busy: boolean;
  /** La cadena paró porque no quedaba saldo (`done.round.stopped`). */
  stoppedForCredits: boolean;
  onResume: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("panelsChat");
  const card = goalCard(goal);
  if (card.kind === "hidden") return null;

  const estado = t(`newChat.goal.${card.kind}`);
  const motivo = card.roundLimit
    ? t("newChat.goal.roundLimit", { max: card.maxGoalRounds })
    : card.kind === "blocked"
      ? card.reason
      : stoppedForCredits && card.kind === "paused"
        ? t("newChat.goal.noCredits")
        : null;
  const tono =
    card.kind === "running"
      ? "text-[var(--nc-accent-text)]"
      : card.kind === "blocked"
        ? "nc-warn"
        : "fg-muted";

  return (
    // Los botones bajan a su propia línea cuando no caben (el móvil): la cabecera
    // y el objetivo se leen enteros antes que los controles.
    <div className="nc-up mb-2 flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-[12px] border bd bg-elev px-3 py-2">
      <span className="mt-0.5 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-accent-soft text-[var(--nc-accent-text)]">
        <Flag size={13} />
      </span>
      <div className="flex min-w-[13rem] flex-1 flex-col leading-[1.35]">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11.5px]">
          <b className="font-semibold fg">{t("newChat.goal.label")}</b>
          <span className="tabular-nums fg-muted">{t("newChat.goal.round", { round: card.round, max: card.maxGoalRounds })}</span>
          <span className={`font-semibold ${tono}`}>· {estado}</span>
        </div>
        <span className="line-clamp-2 break-words text-[12.5px] fg" title={card.objective}>
          {card.objective}
        </span>
        {motivo && <span className="mt-0.5 line-clamp-2 break-words text-[11.5px] italic fg-faint">{motivo}</span>}
      </div>
      {card.kind !== "running" && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 self-center">
          {card.canResume && (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="rounded-full bg-[var(--accent-strong)] px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t("newChat.goal.resume")}
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="rounded-full border bd-strong px-3 py-1 text-[12px] font-semibold fg hover:bg-side disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("newChat.goal.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
