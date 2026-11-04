"use client";
// THE EVENT-TASK CARDS OVER THE COMPOSER (spec local 2026-11-03-len-que-avisa, §7.6, §8), where Len Watch's
// notice sits: what a task's judge decided the owner should hear, with the action Len proposes. «Hazlo» starts
// that turn in this chat (the server runs it; here it is painted running and followed, like a code thread's);
// «Ahora no» sets the card aside. Decided cards of the last 7 days fold under «Avisos anteriores». A reader sees
// them without buttons. A notice's link (`?card=<id>`) scrolls to its card and lights it up.
//
// Each action has its block under the summary (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §8): the data
// change as «columna · antes → después», the message with who it goes to, the subject and the text. «Hazlo» reads
// «Aplicar» or «Aplicar y enviar» when it touches the real data. After it, each action says what came of it, and a card
// that still needs the owner — a row that changed, a message still being sent — stays in sight with «Volver a mirar»
// or «Retirar». «Ahora no» asks «¿Qué cambiarías?»: with a note, the task judges that change again (Claude Code's
// «tell it what to do differently»; the card isn't edited).
//
// The cards are rows of their own (`eventTaskCards`), never chat messages: the conversation's history never
// carries what a judge wrote from a visitor's data.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";

import { EXPIRED, INTERRUPTED, NOT_SENT_CHANGE, WITHDRAWN, type CardActionRecord } from "@/lib/event-tasks/actions/types";
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
  /** Null on a card from before the actions: its proposal is `proposedAction`. */
  readonly actions: readonly CardActionRecord[] | null;
  readonly dismissNote: string | null;
  /** The row or person it is about. */
  readonly subjectKey: string | null;
  /** What Len found when it looked again and made no new card. */
  readonly lookedAgain: string | null;
}

/** The turn «Hazlo» started on the server, for the chat to paint and follow. */
export interface AcceptedTurn {
  readonly filaId: string;
  readonly texto: string;
  readonly origen: EventTaskOrigin;
}

type Press = { action: "accept" } | { action: "dismiss"; note?: string } | { action: "look_again" } | { action: "withdraw_send"; index: number };

/** A judge's card can arrive any minute (the watcher looks every 60 s): the chat looks as often. */
const LOOK_EVERY_MS = 60_000;

function useEventCards(projectId: string, busy: boolean) {
  const [cards, setCards] = useState<readonly EventCard[]>([]);
  const [repliesTo, setRepliesTo] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/event-cards`;
  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const body = (await res.json()) as { cards: EventCard[]; repliesTo?: string | null };
      setCards(body.cards);
      setRepliesTo(body.repliesTo ?? null);
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
  const decide = async (cardId: string, press: Press): Promise<{ ok: boolean; error?: string; turn?: AcceptedTurn }> => {
    const res = await fetch(`${base}/${encodeURIComponent(cardId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(press),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { error?: string; rowId?: string; text?: string; origin?: EventTaskOrigin };
    await load();
    if (!res?.ok) return { ok: false, error: body.error };
    return body.rowId && body.text && body.origin ? { ok: true, turn: { filaId: body.rowId, texto: body.text, origen: body.origin } } : { ok: true };
  };
  return { cards, repliesTo, decide };
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

const has = (card: EventCard, state: CardActionRecord["state"]) => (card.actions ?? []).some((r) => r.state === state);

type T = ReturnType<typeof useTranslations>;

/** What came of one action, in a line; nothing while it waits for «Hazlo». */
function stateLine(rec: CardActionRecord, t: T): { text: string; tone: "ok" | "warn" | "bad" } | null {
  const a = rec.action;
  if (rec.state === "pending") return null;
  if (a.kind === "data_change") {
    if (rec.state === "done") return { text: t("eventTasks.doneApplied", { result: rec.result ?? "" }), tone: "ok" };
    if (rec.state === "blocked") return { text: t("eventTasks.rowChanged"), tone: "warn" };
    if (rec.error === INTERRUPTED) return { text: t("eventTasks.interrupted"), tone: "warn" };
    return { text: t("eventTasks.actionFailed", { error: rec.error ?? "" }), tone: "bad" };
  }
  if (a.kind === "reply") {
    if (rec.state === "done") return { text: t("eventTasks.doneSent", { to: rec.result ?? a.to }), tone: "ok" };
    if (rec.state === "sending") return { text: t("eventTasks.sending", { attempts: rec.attempts }), tone: "warn" };
    if (rec.error === WITHDRAWN) return { text: t("eventTasks.withdrawn"), tone: "bad" };
    if (rec.error === NOT_SENT_CHANGE) return { text: t("eventTasks.notSentChange"), tone: "warn" };
    if (rec.error === EXPIRED) return { text: t("eventTasks.sendExpired"), tone: "bad" };
    return { text: t("eventTasks.sendFailed", { error: rec.error ?? "" }), tone: "bad" };
  }
  if (rec.state === "done") return { text: t("eventTasks.done"), tone: "ok" };
  if (rec.error === INTERRUPTED) return { text: t("eventTasks.interrupted"), tone: "warn" };
  return { text: t("eventTasks.actionFailed", { error: rec.error ?? "" }), tone: "bad" };
}

const TONE = { ok: "text-[var(--nc-ok)]", warn: "text-[var(--nc-warn)]", bad: "nc-bad" } as const;

function StateLine({ rec, t }: { rec: CardActionRecord; t: T }) {
  const line = stateLine(rec, t);
  if (!line) return null;
  return (
    <p data-event-state={rec.state} className={`mt-1 text-[11.5px] font-medium ${TONE[line.tone]}`}>
      {line.text}
      {(rec.state === "blocked" || (rec.state === "failed" && rec.action.kind === "data_change")) && rec.result ? (
        <span className="block font-normal fg-muted">{t("eventTasks.rowNow", { now: rec.result })}</span>
      ) : null}
    </p>
  );
}

/** One block per action, with its state once «Hazlo» ran it. */
function ActionBlocks({ card, repliesTo, t }: { card: EventCard; repliesTo: string | null; t: T }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {(card.actions ?? []).map((rec, i) => {
        const a = rec.action;
        if (a.kind === "data_change") {
          return (
            <div key={i} data-event-action="data_change" className="rounded-lg border bd px-2.5 py-1.5">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] fg-faint">{t("eventTasks.actionData", { table: a.table })}</span>
              <table className="mt-1 w-full text-[12px]">
                <tbody>
                  {Object.entries(a.set).map(([col, value]) => (
                    <tr key={col} data-event-column={col}>
                      <td className="py-0.5 pr-2 font-mono text-[11.5px] fg-muted">{col}</td>
                      <td className="py-0.5 fg">
                        <span className="fg-faint line-through">{a.before[col] ?? "∅"}</span>
                        <span className="px-1.5 fg-faint">→</span>
                        <span className="font-medium">{value}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <StateLine rec={rec} t={t} />
            </div>
          );
        }
        if (a.kind === "reply") {
          return (
            <div key={i} data-event-action="reply" className="rounded-lg border bd px-2.5 py-1.5">
              <span className="block text-[11px] fg-faint">{t("eventTasks.actionReply", { to: a.to })}</span>
              <b className="mt-0.5 block font-semibold fg">{a.subject}</b>
              <p className="mt-1 whitespace-pre-line rounded-md bg-side px-2 py-1.5 leading-snug fg">{a.body}</p>
              {repliesTo ? <span className="mt-1 block text-[11px] fg-faint">{t("eventTasks.repliesGoTo", { email: repliesTo })}</span> : null}
              <StateLine rec={rec} t={t} />
            </div>
          );
        }
        return (
          <div key={i} data-event-action="project" className="rounded-lg bg-accent-soft px-2.5 py-1.5">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--nc-accent-text)]">{t("eventTasks.proposed")}</span>
            <span className="fg">{a.text}</span>
            <StateLine rec={rec} t={t} />
          </div>
        );
      })}
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
  const { cards, repliesTo, decide } = useEventCards(projectId, busy);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ card: string; error?: string } | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [lookingAgain, setLookingAgain] = useState<ReadonlySet<string>>(new Set());
  // A blocked card is over once a newer card about the same row has come.
  const superseded = (c: EventCard) => c.subjectKey !== null && cards.some((o) => o.id !== c.id && o.taskId === c.taskId && o.subjectKey === c.subjectKey && o.createdAt > c.createdAt);
  const needsYou = (c: EventCard) =>
    c.status === "pending" || (c.status === "accepted" && (has(c, "sending") || (has(c, "blocked") && !superseded(c) && !c.lookedAgain)));
  const live = cards.filter(needsYou);
  const decided = cards.filter((c) => !needsYou(c));
  if (cards.length === 0) return null;

  const press = async (card: EventCard, p: Press) => {
    setDeciding(card.id);
    setFailed(null);
    const r = await decide(card.id, p);
    setDeciding(null);
    if (!r.ok) setFailed({ card: card.id, ...(r.error ? { error: r.error } : {}) });
    else if (p.action === "look_again") setLookingAgain((s) => new Set(s).add(card.id));
    else if (p.action === "dismiss") setNoting(null);
    if (r.turn) onFollowTurn(r.turn);
  };
  const dismiss = (card: EventCard) => {
    const trimmed = note.trim();
    void press(card, trimmed ? { action: "dismiss", note: trimmed } : { action: "dismiss" });
  };
  // The accepted turn's row, when the chat has it painted (an older one appears as the conversation scrolls up).
  const openRow = (rowId: string) =>
    [...document.querySelectorAll("[data-chat-row]")].find((el) => el.getAttribute("data-chat-row") === rowId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  // Accepted with actions and none of them done (a row that changed, a send withdrawn): not «Hecho».
  const nothingDone = (c: EventCard) => (c.actions ?? []).length > 0 && !has(c, "done");
  const stateOf = (c: EventCard) =>
    c.status === "accepted" ? t(nothingDone(c) ? "eventTasks.notDone" : "eventTasks.done") : c.status === "dismissed" ? t("eventTasks.dismissed") : t("eventTasks.replaced");
  const acceptLabel = (c: EventCard) => {
    const kinds = new Set((c.actions ?? []).map((r) => r.action.kind));
    return kinds.has("data_change") ? (kinds.has("reply") ? t("eventTasks.applyAndSend") : t("eventTasks.apply")) : t("eventTasks.accept");
  };
  const ghost = "inline-flex h-7 items-center rounded-md px-3 text-[11.5px] font-medium fg-muted transition hover:bg-side hover:fg disabled:opacity-50";

  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2" role="status">
      {live.map((card) => (
        <Card key={card.id} card={card} highlight={highlight === card.id}>
          <div className="flex items-center gap-1.5 text-[11px] fg-faint">
            <Bell size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
            <span className="truncate">{t("eventTasks.cardFrom", { task: card.taskTitle })}</span>
          </div>
          <b className="mt-1 block text-[13px] font-semibold fg">{card.title}</b>
          <p className="mt-0.5 leading-snug fg-muted">{card.summary}</p>
          {card.actions ? (
            <ActionBlocks card={card} repliesTo={repliesTo} t={t} />
          ) : (
            <div data-event-proposed="" className="mt-2 rounded-lg bg-accent-soft px-2.5 py-1.5">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--nc-accent-text)]">{t("eventTasks.proposed")}</span>
              <span className="fg">{card.proposedAction}</span>
            </div>
          )}
          {failed?.card === card.id && (
            <p role="alert" className="mt-1.5 text-[11.5px] nc-bad">
              {failed.error === "daily_limit" ? t("eventTasks.dailyLimit") : t("eventTasks.failed")}
            </p>
          )}
          {card.status === "accepted" && lookingAgain.has(card.id) && !card.lookedAgain && <p className="mt-1.5 text-[11.5px] fg-muted">{t("eventTasks.lookingAgain")}</p>}
          {!soloLectura && card.status === "pending" && (
            <>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  data-event-accept=""
                  disabled={deciding === card.id}
                  onClick={() => void press(card, { action: "accept" })}
                  className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50"
                >
                  {acceptLabel(card)}
                </button>
                <button
                  type="button"
                  data-event-dismiss=""
                  disabled={deciding === card.id}
                  onClick={() => {
                    setNoting(noting === card.id ? null : card.id);
                    setNote("");
                  }}
                  className={ghost}
                >
                  {t("eventTasks.dismiss")}
                </button>
              </div>
              {noting === card.id && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <textarea
                    data-event-note=""
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("eventTasks.whatWouldYouChange")}
                    maxLength={1000}
                    rows={2}
                    className="w-full resize-none rounded-lg border bd bg-app px-2.5 py-1.5 text-[12.5px] fg placeholder:fg-faint focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  <div className="flex justify-end">
                    <button type="button" data-event-dismiss-confirm="" disabled={deciding === card.id} onClick={() => dismiss(card)} className={`${ghost} border bd`}>
                      {note.trim() ? t("eventTasks.askAgain") : t("eventTasks.dismissConfirm")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {!soloLectura && card.status === "accepted" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {has(card, "blocked") && !lookingAgain.has(card.id) && (
                <button type="button" data-event-look-again="" disabled={deciding === card.id} onClick={() => void press(card, { action: "look_again" })} className={`${ghost} border bd`}>
                  {t("eventTasks.lookAgain")}
                </button>
              )}
              {(card.actions ?? []).map((rec, i) =>
                rec.action.kind === "reply" && rec.state === "sending" ? (
                  <button key={i} type="button" data-event-withdraw="" disabled={deciding === card.id} onClick={() => void press(card, { action: "withdraw_send", index: i })} className={ghost}>
                    {t("eventTasks.withdraw")}
                  </button>
                ) : null,
              )}
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
                {/* What each did; a project action's «Hecho» is the card's own state already. */}
                {card.status === "accepted" && (card.actions ?? []).map((rec, i) => (rec.action.kind === "project" ? null : <StateLine key={i} rec={rec} t={t} />))}
                {card.dismissNote ? <p className="mt-1 text-[11.5px] fg-muted">{t("eventTasks.yourNote", { note: card.dismissNote })}</p> : null}
                {card.lookedAgain ? <p data-event-looked-again="" className="mt-1 text-[11.5px] fg">{t("eventTasks.lookedAgain", { answer: card.lookedAgain })}</p> : null}
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
