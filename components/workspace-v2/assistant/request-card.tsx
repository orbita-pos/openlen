"use client";
// ONE CARD OF WHAT VISITORS ASKED FOR (spec local 2026-11-06-asistente-propio, §4.3.3, §4.6): «De Lucía · Envíos a
// domicilio · 5 clientes lo pidieron · Que Len lo haga · Ahora no». Shared by Len's chat (../chat/assistant-request-cards.tsx)
// and her «Pedidos» (./visitor-requests.tsx). Its title was written from visitors' words: React escapes it, and it is
// never HTML. Without `onPress` (a reader) it has no buttons.
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";

import type { RequestCardView } from "@/lib/assistants/requests/view";

export type RequestCardData = RequestCardView;

/** The card's failure, as the owner reads it. */
function failureText(failure: string, t: ReturnType<typeof useTranslations>): string {
  return failure === "no_credits" ? t("ownAssistant.requests.noCredits") : t("ownAssistant.requests.failed");
}

export function RequestCard({
  card,
  assistantName,
  onPress,
  busy,
  failed,
  highlight,
  children,
}: {
  card: RequestCardData;
  assistantName: string;
  /** Absent: read-only, no buttons. */
  onPress?: (action: "accept" | "dismiss") => void;
  busy: boolean;
  /** The last press of this card failed here. */
  failed: boolean;
  highlight: boolean;
  /** What goes under it (her «Pedidos»: where Len is working). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("panelsChat");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  const waiting = card.status === "pending";
  const alert = failed ? t("ownAssistant.requests.failed") : waiting && card.failure ? failureText(card.failure, t) : null;
  return (
    <div
      ref={ref}
      data-assistant-request-card={card.id}
      data-highlight={highlight}
      className={`rounded-xl border bg-elev px-3 py-2.5 text-[12.5px] ${highlight ? "bd-strong ring-2 ring-[var(--accent)]" : "bd"}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] fg-faint">
        <Inbox size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
        <span className="truncate">{t("ownAssistant.requests.from", { name: assistantName })}</span>
        {!waiting && (
          <span data-request-state={card.status} className="ml-auto shrink-0 text-[11.5px] fg-muted">
            {card.status === "accepted" ? t("ownAssistant.requests.done") : t("ownAssistant.requests.dismissed")}
          </span>
        )}
      </div>
      <b className="mt-1 block text-[13px] font-semibold fg">{card.title}</b>
      <p className="mt-0.5 leading-snug fg-muted">{t("ownAssistant.requests.visitors", { count: card.visitors })}</p>
      {alert && (
        <p role="alert" className="mt-1.5 text-[11.5px] nc-bad">
          {alert}
        </p>
      )}
      {onPress && waiting && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            data-request-do-it=""
            disabled={busy}
            onClick={() => onPress("accept")}
            className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50"
          >
            {t("ownAssistant.requests.doIt")}
          </button>
          <button
            type="button"
            data-request-not-now=""
            disabled={busy}
            onClick={() => onPress("dismiss")}
            className="inline-flex h-7 items-center rounded-md px-3 text-[11.5px] font-medium fg-muted transition hover:bg-side hover:fg disabled:opacity-50"
          >
            {t("ownAssistant.requests.notNow")}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
