"use client";
// THE EVENT-TASK CARDS OVER THE COMPOSER (spec local 2026-11-03-len-que-avisa, §7.6, §8), where Len Watch's
// notice sits: what a task's judge decided the owner should hear, with the action Len proposes. «Hazlo» starts
// that turn in this chat (the server runs it; here it is painted running and followed, like a code thread's);
// «Ahora no» sets the card aside. Decided cards of the last 7 days fold under «Avisos anteriores». A reader sees
// them without buttons. A notice's link (`?card=<id>`) scrolls to its card and lights it up.
//
// The cards are rows of their own (`eventTaskCards`), never chat messages: the conversation's history never
// carries what a judge wrote from a visitor's data.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";

import type { EventTaskOrigin } from "@/lib/projects/types";

/** One card as GET /api/projects/[id]/event-cards gives it. */
export interface EventCard {
  readonly id: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly title: string;
  readonly summary: string;
  readonly proposedAction: string;
  readonly status: "pending" | "accepted" | "dismissed" | "replaced";
  readonly acceptedRowId: string | null;
  readonly createdAt: string;
}

/** The turn «Hazlo» started on the server, for the chat to paint and follow. */
export interface AcceptedTurn {
  readonly filaId: string;
  readonly texto: string;
  readonly origen: EventTaskOrigin;
}

/** A judge's card can arrive any minute (the watcher looks every 60 s): the chat looks as often. */
const LOOK_EVERY_MS = 60_000;

function useEventCards(projectId: string, busy: boolean) {
  const [cards, setCards] = useState<readonly EventCard[]>([]);
  const base = `/api/projects/${encodeURIComponent(projectId)}/event-cards`;
  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.ok) setCards(((await res.json()) as { cards: EventCard[] }).cards);
    } catch {
      // Nothing this time; the next look reads again.
    }
  }, [base]);
  useEffect(() => {
    void load();
    const every = setInterval(() => void load(), LOOK_EVERY_MS);
    return () => clearInterval(every);
  }, [load]);
  // A turn that ends may be the one a card started: its card is «Hecho» now.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void load();
    wasBusy.current = busy;
  }, [busy, load]);
  const decide = async (cardId: string, action: "accept" | "dismiss"): Promise<{ ok: boolean; turn?: AcceptedTurn }> => {
    const res = await fetch(`${base}/${encodeURIComponent(cardId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { rowId?: string; text?: string; origin?: EventTaskOrigin };
    await load();
    if (!res?.ok) return { ok: false };
    return body.rowId && body.text && body.origin ? { ok: true, turn: { filaId: body.rowId, texto: body.text, origen: body.origin } } : { ok: true };
  };
  return { cards, decide };
}

function Card({ card, highlight, children }: { card: EventCard; highlight: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  return (
    <div
      ref={ref}
      data-event-card={card.id}
      data-highlight={highlight}
      className={`rounded-xl border bg-elev px-3 py-2.5 text-[12.5px] ${highlight ? "bd-strong ring-2 ring-[var(--accent)]" : "bd"}`}
    >
      {children}
    </div>
  );
}

export function EventCards({
  projectId,
  soloLectura,
  busy,
  onFollowTurn,
}: {
  projectId: string;
  soloLectura?: boolean;
  busy: boolean;
  onFollowTurn: (turn: AcceptedTurn) => void;
}) {
  const t = useTranslations("panelsChat");
  const highlight = useSearchParams()?.get("card") ?? null;
  const { cards, decide } = useEventCards(projectId, busy);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pending = cards.filter((c) => c.status === "pending");
  const decided = cards.filter((c) => c.status !== "pending");
  if (cards.length === 0) return null;

  const press = async (card: EventCard, action: "accept" | "dismiss") => {
    setDeciding(card.id);
    setFailed(null);
    const r = await decide(card.id, action);
    setDeciding(null);
    if (!r.ok) setFailed(card.id);
    else if (r.turn) onFollowTurn(r.turn);
  };
  // The accepted turn's row, when the chat has it painted (an older one appears as the conversation scrolls up).
  const openRow = (rowId: string) =>
    [...document.querySelectorAll("[data-chat-row]")].find((el) => el.getAttribute("data-chat-row") === rowId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const stateOf = (c: EventCard) => (c.status === "accepted" ? t("eventTasks.done") : c.status === "dismissed" ? t("eventTasks.dismissed") : t("eventTasks.replaced"));

  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2" role="status">
      {pending.map((card) => (
        <Card key={card.id} card={card} highlight={highlight === card.id}>
          <div className="flex items-center gap-1.5 text-[11px] fg-faint">
            <Bell size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
            <span className="truncate">{t("eventTasks.cardFrom", { task: card.taskTitle })}</span>
          </div>
          <b className="mt-1 block text-[13px] font-semibold fg">{card.title}</b>
          <p className="mt-0.5 leading-snug fg-muted">{card.summary}</p>
          <div data-event-proposed="" className="mt-2 rounded-lg bg-accent-soft px-2.5 py-1.5">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--nc-accent-text)]">{t("eventTasks.proposed")}</span>
            <span className="fg">{card.proposedAction}</span>
          </div>
          {failed === card.id && (
            <p role="alert" className="mt-1.5 text-[11.5px] nc-bad">
              {t("eventTasks.failed")}
            </p>
          )}
          {!soloLectura && (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                data-event-accept=""
                disabled={deciding === card.id}
                onClick={() => void press(card, "accept")}
                className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50"
              >
                {t("eventTasks.accept")}
              </button>
              <button
                type="button"
                data-event-dismiss=""
                disabled={deciding === card.id}
                onClick={() => void press(card, "dismiss")}
                className="inline-flex h-7 items-center rounded-md px-3 text-[11.5px] font-medium fg-muted transition hover:bg-side hover:fg disabled:opacity-50"
              >
                {t("eventTasks.dismiss")}
              </button>
            </div>
          )}
        </Card>
      ))}
      {decided.length > 0 && (
        <details data-event-earlier="" open={decided.some((c) => c.id === highlight) || undefined} className="text-[12px]">
          <summary className="cursor-pointer select-none px-1 fg-faint hover:fg">{`${t("eventTasks.earlier")} (${decided.length})`}</summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {decided.map((card) => (
              <Card key={card.id} card={card} highlight={highlight === card.id}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] fg-faint">{card.taskTitle}</span>
                    <b className="block truncate font-semibold fg">{card.title}</b>
                  </div>
                  {card.status === "accepted" && card.acceptedRowId ? (
                    <button
                      type="button"
                      data-event-done=""
                      onClick={() => openRow(card.acceptedRowId!)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--nc-accent-text)] hover:bg-side"
                    >
                      {stateOf(card)}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11.5px] fg-muted">{stateOf(card)}</span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
