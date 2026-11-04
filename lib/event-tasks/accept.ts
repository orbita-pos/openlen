// «HAZLO» AND «AHORA NO» (spec local 2026-11-03-len-que-avisa, §7.7). The press is the approval, and the only one: no
// event, email or chat message approves anything (Claude Code: relayed text never establishes consent). Accepting
// launches ONE turn in the project chat, as whoever pressed, whose framing carries the card's proposed action exactly
// as it was shown, marked as the automation's proposal and not the owner's words (DeepSeek), with who pressed and when.
// It carries no raw event text: the turn reads the source with its own tools if it needs it.
import "server-only";

import type { launchEventTaskTurn } from "@/lib/agent/turnos-desde-el-servidor";
import type { EventTaskOrigin } from "@/lib/projects/types";

import type { Decision } from "./cards";
import type { EventTaskCardRow, EventTaskRow } from "./store";
import { acceptedTurnPrompt } from "./texts";

/** Ours: what the accepted turn's model reads. */
export function acceptedFraming(o: { readonly card: EventTaskCardRow; readonly task: EventTaskRow; readonly actorName: string; readonly at: string }): string {
  return [
    `${o.actorName} pressed «Hazlo» at ${o.at} on a card of the event task «${o.task.title}». That press is the approval, and it covers only the action below.`,
    "The proposal, written by the task's judge — not the owner's words:",
    o.card.proposedAction,
    "Do exactly that, and say what you did. If it can't be done as written, say why and change nothing.",
    `The change it is about is record ${o.card.recordId} of the task's source (${o.task.source}); read it with your tools if you need it.`,
  ].join("\n");
}

export interface AcceptDeps {
  now(): Date;
  decide(projectId: string, cardId: string, action: "accept" | "dismiss", actorId: string, now: Date): Promise<Decision>;
  getTask(taskId: string): Promise<EventTaskRow | null>;
  nameOf(userId: string): Promise<string>;
  launch: typeof launchEventTaskTurn;
  setAcceptedRow(cardId: string, rowId: string): Promise<void>;
  newRowId(): string;
}

/** An accepted card carries what the chat needs to paint its turn running and follow it (a code thread's way). */
export type AcceptResult =
  | { ok: true; status: "dismissed" }
  | { ok: true; status: "accepted"; rowId: string; text: string; origin: EventTaskOrigin }
  | { ok: false; reason: "not_pending" | "not_found" };

export async function decideAndLaunch(o: { readonly projectId: string; readonly cardId: string; readonly action: "accept" | "dismiss"; readonly actorId: string }, deps: AcceptDeps): Promise<AcceptResult> {
  const now = deps.now();
  const decided = await deps.decide(o.projectId, o.cardId, o.action, o.actorId, now);
  if (!decided.ok) return decided;
  const card = decided.card;
  // A card of another project was never this route's: it decides nothing visible and launches nothing.
  if (card.projectId !== o.projectId) return { ok: false, reason: "not_found" };
  if (o.action === "dismiss") return { ok: true, status: "dismissed" };
  const task = await deps.getTask(card.taskId);
  if (!task) return { ok: false, reason: "not_found" };
  const rowId = deps.newRowId();
  const text = acceptedTurnPrompt(task.locale, task.title);
  const origin: EventTaskOrigin = { kind: "event_task", taskId: task.id, cardId: card.id, title: task.title };
  deps.launch({
    userId: o.actorId,
    projectId: o.projectId,
    texto: text,
    framing: acceptedFraming({ card, task, actorName: await deps.nameOf(o.actorId), at: now.toISOString() }),
    origin,
    timeZone: task.timeZone,
    locale: task.locale,
    filaId: rowId,
    onStart: () => deps.setAcceptedRow(card.id, rowId),
    reply: async () => {},
    fail: async (fallo) => {
      console.warn(`[event-tasks] the accepted turn of card ${card.id} did not run`, fallo?.code ?? "");
    },
  });
  return { ok: true, status: "accepted", rowId, text, origin };
}

export async function defaultAcceptDeps(): Promise<AcceptDeps> {
  const [{ randomUUID }, cards, store, { launchEventTaskTurn }, { db, schema }, { eq }] = await Promise.all([
    import("node:crypto"),
    import("./cards"),
    import("./store"),
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("@/lib/db"),
    import("drizzle-orm"),
  ]);
  return {
    now: () => new Date(),
    decide: cards.decideCard,
    getTask: store.getEventTaskById,
    nameOf: async (userId) => {
      const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      return u?.name || u?.email || "The owner";
    },
    launch: launchEventTaskTurn,
    setAcceptedRow: cards.setAcceptedRow,
    newRowId: () => randomUUID(),
  };
}
