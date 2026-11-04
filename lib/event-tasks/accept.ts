// «HAZLO» AND «AHORA NO» (spec local 2026-11-03-len-que-avisa, §7.7; 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3,
// §7.6.7). The press is the approval, and the only one: no event, email or chat message approves anything (Claude Code:
// relayed text never establishes consent). A card does what it shows, in order: the data change is applied (the
// OWNER's, compared, never Len's), the reply goes out only if the change was done or there was none, and a project
// action launches ONE turn in the project chat, as whoever pressed, whose framing carries that action exactly as it
// was shown, marked as the automation's proposal and not the owner's words (DeepSeek), with who pressed and when. It
// carries no raw event text: the turn reads the source with its own tools if it needs it. «Ahora no» with a note, and
// «Volver a mirar» on a blocked card, send the record back to its judge — the person's message reaching the work.
import "server-only";

import type { launchEventTaskTurn } from "@/lib/agent/turnos-desde-el-servidor";
import type { EventTaskOrigin } from "@/lib/projects/types";

import type { Applied } from "./actions/apply";
import type { ActionState, CardAction, CardActionRecord } from "./actions/types";
import type { Decision } from "./cards";
import type { EventTaskCardRow, EventTaskRow } from "./store";
import { acceptedTurnPrompt } from "./texts";
import { dayOf } from "./watcher";

/** Ours: what the accepted turn's model reads. */
export function acceptedFraming(o: { readonly card: EventTaskCardRow; readonly task: EventTaskRow; readonly actorName: string; readonly at: string; readonly proposal?: string }): string {
  return [
    `${o.actorName} pressed «Hazlo» at ${o.at} on a card of the event task «${o.task.title}». That press is the approval, and it covers only the action below.`,
    "The proposal, written by the task's judge — not the owner's words:",
    o.proposal ?? o.card.proposedAction,
    "Do exactly that, and say what you did. If it can't be done as written, say why and change nothing.",
    `The change it is about is record ${o.card.recordId} of the task's source (${o.task.source}); read it with your tools if you need it.`,
  ].join("\n");
}

export interface AcceptDeps {
  now(): Date;
  decide(projectId: string, cardId: string, action: "accept" | "dismiss", actorId: string, now: Date, note: string | null): Promise<Decision>;
  getTask(taskId: string): Promise<EventTaskRow | null>;
  getCard(cardId: string): Promise<EventTaskCardRow | null>;
  nameOf(userId: string): Promise<string>;
  launch: typeof launchEventTaskTurn;
  setAcceptedRow(cardId: string, rowId: string): Promise<void>;
  newRowId(): string;
  /** The owner's «Aplicar» (./actions/apply.ts). */
  apply(card: EventTaskCardRow, index: number): Promise<Applied>;
  /** The owner's reply, stored and sent once (./actions/send.ts). */
  send(card: EventTaskCardRow, index: number): Promise<{ state: ActionState; error: string | null }>;
  record(cardId: string, index: number, patch: Partial<Omit<CardActionRecord, "action">>): Promise<void>;
  requeue(recordId: string, note: string | null, day: string, now: Date): Promise<{ ok: true } | { ok: false; reason: "daily_limit" | "not_found" }>;
  withdraw(cardId: string, index: number): Promise<void>;
}

interface PressOf {
  readonly projectId: string;
  readonly cardId: string;
  readonly actorId: string;
}
type LookAgain = PressOf & { readonly action: "look_again" };
type Withdraw = PressOf & { readonly action: "withdraw_send"; readonly index: number };
export type Press = (PressOf & { readonly action: "accept" }) | (PressOf & { readonly action: "dismiss"; readonly note?: string | null }) | LookAgain | Withdraw;

/** What came of one of the card's actions. */
export interface ActionResult {
  readonly kind: CardAction["kind"];
  readonly state: ActionState;
  readonly error: string | null;
}

/** An accepted card answers what each action did; one that launched a turn carries what the chat needs to paint it
 *  running and follow it (a code thread's way). */
export type AcceptResult =
  | { ok: true; status: "dismissed"; lookingAgain?: true }
  | { ok: true; status: "accepted"; results: ActionResult[]; rowId?: string; text?: string; origin?: EventTaskOrigin }
  | { ok: true; status: "looking_again" }
  | { ok: true; status: "withdrawn" }
  | { ok: false; reason: "not_pending" | "not_found" | "daily_limit" | "not_blocked" | "not_sending" };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function decideAndLaunch(o: Press, deps: AcceptDeps): Promise<AcceptResult> {
  const now = deps.now();
  if (o.action === "look_again" || o.action === "withdraw_send") return onDecided(o, deps, now);
  const note = o.action === "dismiss" ? (o.note ?? null) : null;
  const decided = await deps.decide(o.projectId, o.cardId, o.action, o.actorId, now, note);
  if (!decided.ok) return decided;
  const card = decided.card;
  // A card of another project was never this route's: it decides nothing visible and launches nothing.
  if (card.projectId !== o.projectId) return { ok: false, reason: "not_found" };
  if (o.action === "dismiss") {
    if (!note) return { ok: true, status: "dismissed" };
    const task = await deps.getTask(card.taskId);
    if (!task) return { ok: true, status: "dismissed" };
    const again = await deps.requeue(card.recordId, note, dayOf(now, task.timeZone), now);
    if (again.ok) return { ok: true, status: "dismissed", lookingAgain: true };
    return again.reason === "daily_limit" ? { ok: false, reason: "daily_limit" } : { ok: true, status: "dismissed" };
  }
  const task = await deps.getTask(card.taskId);
  if (!task) return { ok: false, reason: "not_found" };
  return act(card, task, o.actorId, now, deps);
}

/** «Volver a mirar» and «Retirar» act on a card already decided. */
async function onDecided(o: LookAgain | Withdraw, deps: AcceptDeps, now: Date): Promise<AcceptResult> {
  const card = await deps.getCard(o.cardId);
  if (!card || card.projectId !== o.projectId) return { ok: false, reason: "not_found" };
  if (o.action === "withdraw_send") {
    const rec = card.actions?.[o.index];
    if (!rec || rec.action.kind !== "reply" || rec.state !== "sending") return { ok: false, reason: "not_sending" };
    await deps.withdraw(card.id, o.index);
    return { ok: true, status: "withdrawn" };
  }
  if (!(card.actions ?? []).some((r) => r.state === "blocked")) return { ok: false, reason: "not_blocked" };
  const task = await deps.getTask(card.taskId);
  if (!task) return { ok: false, reason: "not_found" };
  const again = await deps.requeue(card.recordId, null, dayOf(now, task.timeZone), now);
  if (!again.ok) return { ok: false, reason: again.reason };
  return { ok: true, status: "looking_again" };
}

/** The card's actions, in order: the change, then the reply if the change was done or there was none, then the turn. */
async function act(card: EventTaskCardRow, task: EventTaskRow, actorId: string, now: Date, deps: AcceptDeps): Promise<AcceptResult> {
  const records = card.actions ?? [];
  const results: ActionResult[] = records.map((r) => ({ kind: r.action.kind, state: r.state, error: r.error }));
  let changeDone = true;
  for (const [i, rec] of records.entries()) {
    if (rec.action.kind !== "data_change") continue;
    try {
      const applied = await deps.apply(card, i);
      results[i] = { kind: "data_change", state: applied.state, error: applied.error };
    } catch (err) {
      console.error(`[event-tasks] card ${card.id} could not apply its change`, err);
      await deps.record(card.id, i, { state: "failed", error: message(err) }).catch(() => {});
      results[i] = { kind: "data_change", state: "failed", error: message(err) };
    }
    changeDone &&= results[i]!.state === "done";
  }
  for (const [i, rec] of records.entries()) {
    if (rec.action.kind !== "reply" || !changeDone) continue;
    try {
      results[i] = { kind: "reply", ...(await deps.send(card, i)) };
    } catch (err) {
      // It was recorded «sending» before the attempt: the watcher's pass tries it again.
      console.error(`[event-tasks] card ${card.id} could not send its reply`, err);
      results[i] = { kind: "reply", state: "sending", error: message(err) };
    }
  }
  const projectIndex = records.findIndex((r) => r.action.kind === "project");
  // A card from before the actions (spec local 2026-11-03-len-que-avisa) is one project action: its proposed text.
  if (records.length > 0 && projectIndex < 0) return { ok: true, status: "accepted", results };
  const proposal = projectIndex >= 0 ? (records[projectIndex]!.action as { text: string }).text : card.proposedAction;
  const rowId = deps.newRowId();
  const text = acceptedTurnPrompt(task.locale, task.title);
  const origin: EventTaskOrigin = { kind: "event_task", taskId: task.id, cardId: card.id, title: task.title };
  deps.launch({
    userId: actorId,
    projectId: card.projectId,
    texto: text,
    framing: acceptedFraming({ card, task, actorName: await deps.nameOf(actorId), at: now.toISOString(), proposal }),
    origin,
    timeZone: task.timeZone,
    locale: task.locale,
    filaId: rowId,
    onStart: () => deps.setAcceptedRow(card.id, rowId),
    reply: async () => {},
    fail: async (fallo) => {
      console.warn(`[event-tasks] the accepted turn of card ${card.id} did not run`, fallo?.code ?? "");
      if (projectIndex >= 0) await deps.record(card.id, projectIndex, { state: "failed", error: fallo?.code ?? "the turn did not run" }).catch(() => {});
    },
  });
  if (projectIndex >= 0) {
    await deps.record(card.id, projectIndex, { state: "done", result: rowId, error: null });
    results[projectIndex] = { kind: "project", state: "done", error: null };
  }
  return { ok: true, status: "accepted", results, rowId, text, origin };
}

export async function defaultAcceptDeps(): Promise<AcceptDeps> {
  const [{ randomUUID }, cards, store, { launchEventTaskTurn }, { db, schema }, { eq }, apply, send] = await Promise.all([
    import("node:crypto"),
    import("./cards"),
    import("./store"),
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("@/lib/db"),
    import("drizzle-orm"),
    import("./actions/apply"),
    import("./actions/send"),
  ]);
  return {
    now: () => new Date(),
    decide: cards.decideCard,
    getTask: store.getEventTaskById,
    getCard: cards.getCard,
    nameOf: async (userId) => {
      const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      return u?.name || u?.email || "The owner";
    },
    launch: launchEventTaskTurn,
    setAcceptedRow: cards.setAcceptedRow,
    newRowId: () => randomUUID(),
    apply: async (card, index) => apply.applyDataChange(card, index, await apply.defaultApplyDeps()),
    send: async (card, index) => send.sendReply(card, index, await send.defaultSendReplyDeps(), new Date()),
    record: cards.updateCardAction,
    requeue: store.requeueRecord,
    withdraw: (cardId, index) => send.withdrawSend(cardId, index, { record: cards.updateCardAction }),
  };
}
