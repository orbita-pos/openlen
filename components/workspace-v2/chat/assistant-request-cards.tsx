"use client";
// HER REQUESTS IN LEN'S CHAT (spec local 2026-11-06-asistente-propio, §4.3.3, §4.6.1): one chat per place — in the
// project there is only Len, and what her visitors asked for and she couldn't do reaches him as a card over the composer,
// where an event task's card sits (./event-cards.tsx): «De Lucía · Envíos a domicilio · 5 clientes lo pidieron». «Que Len
// lo haga» starts his turn on the server (only the owner's press does) and the chat paints it running and follows it;
// «Ahora no» sets it aside. Decided cards of the last 7 days fold below. A reader sees no buttons; a notice's link
// (`?card=<id>`) lights its card up. The cards are rows of their own, never chat messages: the conversation's history
// never carries what was written from visitors' words.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import type { AssistantRequestOrigin } from "@/lib/projects/types";

import { RequestCard, type RequestCardData } from "../assistant/request-card";

/** One card as GET /api/projects/[id]/assistant-requests gives it. */
export interface ChatRequestCard extends RequestCardData {
  readonly assistantId: string;
  readonly assistantName: string;
}

/** The turn «Que Len lo haga» started on the server, for the chat to paint and follow. */
export interface RequestTurn {
  readonly filaId: string;
  readonly texto: string;
  readonly origen: AssistantRequestOrigin;
}

/** Cards are joined every five minutes: the chat looks every minute, as for an event task's. */
const LOOK_EVERY_MS = 60_000;

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function AssistantRequestCards({
  projectId,
  soloLectura,
  busy,
  onFollowTurn,
}: {
  projectId: string;
  soloLectura?: boolean;
  busy: boolean;
  onFollowTurn: (turn: RequestTurn) => void;
}) {
  const t = useTranslations("panelsChat");
  const highlight = useSearchParams()?.get("card") ?? null;
  const [cards, setCards] = useState<readonly ChatRequestCard[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assistant-requests`);
      if (!res.ok) return;
      setCards(((await res.json()) as { cards?: ChatRequestCard[] }).cards ?? []);
    } catch {
      // Nothing this time; the next look reads again.
    }
  }, [projectId]);
  useEffect(() => {
    void load();
    const every = setInterval(() => void load(), LOOK_EVERY_MS);
    return () => clearInterval(every);
  }, [load]);
  // A turn that ends may be the one a card started.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void load();
    wasBusy.current = busy;
  }, [busy, load]);

  if (cards.length === 0) return null;
  const live = cards.filter((c) => c.status === "pending");
  const decided = cards.filter((c) => c.status !== "pending");

  const press = async (card: ChatRequestCard, action: "accept" | "dismiss") => {
    setDeciding(card.id);
    setFailed(null);
    const zone = timeZone();
    const res = await fetch(`/api/assistants/${encodeURIComponent(card.assistantId)}/requests/${encodeURIComponent(card.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(zone ? { timeZone: zone } : {}) }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { rowId?: string; text?: string; origin?: AssistantRequestOrigin };
    setDeciding(null);
    if (!res?.ok) setFailed(card.id);
    else if (body.rowId && body.text && body.origin) onFollowTurn({ filaId: body.rowId, texto: body.text, origen: body.origin });
    await load();
  };
  // The accepted turn's row, when the chat has it painted.
  const openRow = (rowId: string) =>
    [...document.querySelectorAll("[data-chat-row]")].find((el) => el.getAttribute("data-chat-row") === rowId)?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2" role="status">
      {live.map((card) => (
        <RequestCard
          key={card.id}
          card={card}
          assistantName={card.assistantName}
          {...(soloLectura ? {} : { onPress: (action: "accept" | "dismiss") => void press(card, action) })}
          busy={deciding === card.id}
          failed={failed === card.id}
          highlight={highlight === card.id}
        />
      ))}
      {decided.length > 0 && (
        <details data-request-earlier="" open={decided.some((c) => c.id === highlight) || undefined} className="text-[12px]">
          <summary className="cursor-pointer select-none px-1 fg-faint hover:fg">{`${t("ownAssistant.requests.earlier")} (${decided.length})`}</summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {decided.map((card) => (
              <RequestCard key={card.id} card={card} assistantName={card.assistantName} busy={false} failed={false} highlight={highlight === card.id}>
                {card.status === "accepted" && card.acceptedRowId ? (
                  <button
                    type="button"
                    data-request-open-row=""
                    onClick={() => openRow(card.acceptedRowId!)}
                    className="mt-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--nc-accent-text)] hover:bg-side"
                  >
                    {t("ownAssistant.requests.openChat")}
                  </button>
                ) : null}
              </RequestCard>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
