"use client";

// HER «PEDIDOS» (spec local 2026-11-06-asistente-propio, §4.3, §4.6.2): what visitors asked for and couldn't be done,
// joined into cards — the waiting ones first, then what was decided in the last 30 days — in every project she serves.
// «Que Len lo haga» from here starts Len's turn in that project's chat (only the owner's press does), and the card says
// where to see him working.
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { RequestCard, type RequestCardData } from "./request-card";

interface PlaceCard extends RequestCardData {
  readonly projectTitle: string | null;
}

export function VisitorRequests({ assistantId, name }: { assistantId: string; name: string }) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [cards, setCards] = useState<readonly PlaceCard[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The cards pressed here, by the project whose chat Len works in. */
  const [working, setWorking] = useState<Readonly<Record<string, string>>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/assistants/${encodeURIComponent(assistantId)}/requests`);
      if (!res.ok) throw new Error(String(res.status));
      setCards(((await res.json()) as { cards?: PlaceCard[] }).cards ?? []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [assistantId]);
  useEffect(() => {
    void load();
  }, [load]);

  const press = async (card: PlaceCard, action: "accept" | "dismiss") => {
    setDeciding(card.id);
    setFailed(null);
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    const res = await fetch(`/api/assistants/${encodeURIComponent(assistantId)}/requests/${encodeURIComponent(card.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(zone ? { timeZone: zone } : {}) }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { status?: string; projectId?: string };
    setDeciding(null);
    if (!res?.ok) setFailed(card.id);
    else if (body.status === "accepted") setWorking((w) => ({ ...w, [card.id]: body.projectId ?? card.projectId }));
    await load();
  };

  const chatOf = (projectId: string) => `/${locale}/new?project=${encodeURIComponent(projectId)}&chat=1`;

  if (loadFailed && cards === null) {
    return (
      <div className="m-auto p-6 text-[13px] fg-muted" data-visitor-requests="">
        {t("ownAssistant.requests.loadError")}
      </div>
    );
  }
  if (cards === null) return <div className="flex-1" data-visitor-requests="" />;
  // Waiting first; the rest as the server ordered them (newest first).
  const ordered = [...cards.filter((c) => c.status === "pending"), ...cards.filter((c) => c.status !== "pending")];
  return (
    <div className="nice-scroll min-h-0 flex-1 overflow-y-auto" data-visitor-requests="">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2 px-4 py-5">
        {ordered.length === 0 ? (
          <p className="py-10 text-center text-[13px] fg-muted">{t("ownAssistant.requests.empty", { name })}</p>
        ) : (
          ordered.map((card) => {
            const where = working[card.id] ?? (card.status === "accepted" ? card.projectId : null);
            return (
              <RequestCard
                key={card.id}
                card={card}
                assistantName={name}
                onPress={(action) => void press(card, action)}
                busy={deciding === card.id}
                failed={failed === card.id}
                highlight={false}
              >
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                  {card.projectTitle ? <span className="fg-faint">{t("ownAssistant.place.inProject", { project: card.projectTitle })}</span> : null}
                  {where ? (
                    <a data-request-where="" href={chatOf(where)} className="font-medium text-[var(--nc-accent-text)] hover:underline">
                      {t("ownAssistant.requests.openChat")}
                    </a>
                  ) : null}
                </div>
              </RequestCard>
            );
          })
        )}
      </div>
    </div>
  );
}
