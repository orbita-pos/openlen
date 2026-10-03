"use client";

// ¿TE SIRVIÓ? (plans/new-chat/, decisión de Jesús del 03/10): 👍/👎 al cierre de
// cada turno. Discreto: aparece al pasar por el turno y siempre en el último
// (`.nc-fb` en new-chat.css). 👎 abre los motivos y una nota; se guarda en
// `/api/projects/[id]/chat/feedback` y lo lee el equipo para mejorar a Len.
// Votar otra vez lo cambia; volver a pulsar el mismo lo quita.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { FEEDBACK_REASONS, type FeedbackReason, type TurnFeedback } from "@/lib/chat/feedback-reasons";

export function FeedbackButtons({
  vote,
  onUp,
  onDown,
}: {
  vote: TurnFeedback | undefined;
  onUp: () => void;
  onDown: () => void;
}) {
  const t = useTranslations("panelsChat");
  const base =
    "grid h-[26px] w-[26px] place-items-center rounded-[7px] fg-faint transition hover:bg-[color-mix(in_oklab,var(--fg)_7%,transparent)] hover:fg";
  return (
    <span className="nc-fb ml-auto inline-flex items-center gap-px" data-voted={vote ? "true" : "false"}>
      <button
        type="button"
        onClick={onUp}
        aria-pressed={vote?.rating === "up"}
        aria-label={t("newChat.feedback.up")}
        title={t("newChat.feedback.up")}
        className={`${base} ${vote?.rating === "up" ? "!text-[var(--accent-strong)]" : ""}`}
      >
        <ThumbsUp size={14} className={vote?.rating === "up" ? "nc-pop fill-[color-mix(in_oklab,var(--accent)_24%,transparent)]" : ""} />
      </button>
      <button
        type="button"
        onClick={onDown}
        aria-pressed={vote?.rating === "down"}
        aria-label={t("newChat.feedback.down")}
        title={t("newChat.feedback.down")}
        className={`${base} ${vote?.rating === "down" ? "!text-[var(--accent-strong)]" : ""}`}
      >
        <ThumbsDown size={14} className={vote?.rating === "down" ? "nc-pop fill-[color-mix(in_oklab,var(--accent)_24%,transparent)]" : ""} />
      </button>
    </span>
  );
}

/** Los motivos de un 👎 y una nota opcional. */
export function FeedbackForm({
  initial,
  onSend,
  onCancel,
}: {
  initial: TurnFeedback | undefined;
  onSend: (reasons: readonly FeedbackReason[], note: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("panelsChat");
  const [reasons, setReasons] = useState<readonly FeedbackReason[]>(initial?.reasons ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const toggle = (r: FeedbackReason) =>
    setReasons((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  // Se abre debajo del cierre del turno, casi siempre por debajo del borde de
  // la lista: sin esto el 👎 parecía no hacer nada.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div ref={box} className="nc-card-in rounded-[14px] border bd bg-elev px-3.5 py-3">
      <b className="mb-2 block text-[13px] font-semibold">{t("newChat.feedback.title")}</b>
      <div className="flex flex-wrap gap-1.5">
        {FEEDBACK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={reasons.includes(r)}
            onClick={() => toggle(r)}
            className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
              reasons.includes(r)
                ? "border-[color:var(--accent)] bg-accent-soft fg"
                : "bd-strong bg-elev fg-muted hover:border-[color:var(--accent)]"
            }`}
          >
            {t(`newChat.feedback.reasons.${r}`)}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 1000))}
        rows={2}
        placeholder={t("newChat.feedback.notePlaceholder")}
        className="mt-2.5 block w-full resize-none rounded-[10px] border bd-strong bg-transparent px-2.5 py-2 text-[13px] leading-snug fg outline-none placeholder:fg-faint focus:border-[color:var(--accent-ring)]"
      />
      <p className="mt-1.5 text-[11.5px] fg-faint">{t("newChat.feedback.privacy")}</p>
      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => onSend(reasons, note)}
          className="rounded-full bg-[var(--accent-strong)] px-3 py-1 text-[12.5px] font-medium text-white hover:brightness-105"
        >
          {t("newChat.feedback.send")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border bd-strong px-3 py-1 text-[12.5px] fg-muted hover:fg"
        >
          {t("newChat.feedback.cancel")}
        </button>
      </div>
    </div>
  );
}
