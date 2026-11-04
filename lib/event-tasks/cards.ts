// CARDS (spec local 2026-11-03-len-que-avisa, §7.6, §7.7): what `automation_notify` leaves for the owner. A card,
// a push and an email together (DeepSeek's notice: an action card, the unread mark and the system notification).
// A newer pending card of the same task replaces the older, as DeepSeek's action cards do; a card is decided once,
// with compare-and-swap. Cards are rows of their own: they never enter what Len reads in the project chat.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { LenAvisoEvent } from "@/lib/notifications/types";

import { actionsLine, freshRecord, type CardAction, type CardActionRecord } from "./actions/types";
import type { EventTaskCardRow, EventTaskRow } from "./store";
import { cardEmail } from "./texts";

const c = schema.eventTaskCards;
/** Claude Code's PushNotification: under 200 characters, one line, no markdown. */
const PUSH_MAX = 200;

export function pushText(title: string): string {
  const line = title.replace(/[*_`#>~]+/g, "").replace(/\s+/g, " ").trim();
  return line.length < PUSH_MAX ? line : `${line.slice(0, PUSH_MAX - 1).trimEnd()}…`;
}

export interface CardDeps {
  notify(event: LenAvisoEvent, dedupeKey: string): Promise<void>;
  siteUrl: string;
}

async function defaultCardDeps(): Promise<CardDeps> {
  const { scheduleNotification } = await import("@/lib/notifications/dispatch");
  return { notify: (event, dedupeKey) => scheduleNotification(event, dedupeKey), siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com" };
}

export async function createCard(
  o: {
    readonly task: EventTaskRow;
    readonly recordId: string;
    readonly title: string;
    readonly summary: string;
    readonly actions: readonly CardAction[];
    /** The row or person it is about (spec local 2026-11-04-hazlo, §7.6.2). */
    readonly subjectKey: string;
  },
  deps?: CardDeps,
): Promise<EventTaskCardRow> {
  const d = deps ?? (await defaultCardDeps());
  // A task can have several cards waiting, one per row or person — DeepSeek's several Tickets on a Thread. Only the
  // pending card about the same one is replaced.
  // `decidedAt` too: the next judge hears that it was replaced, as it hears the owner's decisions.
  await db
    .update(c)
    .set({ status: "replaced", decidedAt: new Date() })
    .where(and(eq(c.taskId, o.task.id), eq(c.status, "pending"), eq(c.subjectKey, o.subjectKey)));
  const proposedAction = actionsLine(o.actions);
  const [card] = await db
    .insert(c)
    .values({
      id: randomUUID(),
      taskId: o.task.id,
      projectId: o.task.projectId,
      recordId: o.recordId,
      title: o.title,
      summary: o.summary,
      proposedAction,
      actions: o.actions.map(freshRecord),
      subjectKey: o.subjectKey,
    })
    .returning();
  const url = `${d.siteUrl}/new?project=${encodeURIComponent(o.task.projectId)}&chat=1&card=${encodeURIComponent(card!.id)}`;
  const email = cardEmail(o.task.locale, { task: o.task.title, title: o.title, summary: o.summary, action: proposedAction, url });
  await d.notify(
    {
      type: "len_aviso",
      projectId: o.task.projectId,
      recipientUserId: o.task.createdBy,
      cardId: card!.id,
      title: o.task.title,
      push: pushText(o.title),
      emailSubject: email.subject,
      emailText: email.text,
    },
    // Keyed by the task: a notice still waiting (quiet hours) is replaced by the newest card's, so a night of
    // replaced cards doesn't fire one push each in the morning (final review I11).
    `len_aviso:${o.task.id}`,
  );
  return card!;
}

export type Decision = { ok: true; card: EventTaskCardRow } | { ok: false; reason: "not_pending" | "not_found" };

/** «Hazlo» or «Ahora no»: once, whoever presses first, and only from the card's own project — the route checked
 *  access to THAT project, so a card id of another one decides nothing (final review C2). */
export async function decideCard(projectId: string, cardId: string, action: "accept" | "dismiss", actorId: string, now: Date): Promise<Decision> {
  const [card] = await db
    .update(c)
    .set({ status: action === "accept" ? "accepted" : "dismissed", decidedBy: actorId, decidedAt: now })
    .where(and(eq(c.id, cardId), eq(c.projectId, projectId), eq(c.status, "pending")))
    .returning();
  if (card) return { ok: true, card };
  const [exists] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, cardId), eq(c.projectId, projectId))).limit(1);
  return { ok: false, reason: exists ? "not_pending" : "not_found" };
}

/** The card a delivered record made, if it made one: a restart after the notice must not notify again. */
export async function cardOfRecord(recordId: string): Promise<EventTaskCardRow | null> {
  const [card] = await db.select().from(c).where(eq(c.recordId, recordId)).limit(1);
  return card ?? null;
}

/** One action's record of a card changes, in one statement: the others stay as they are. */
export async function updateCardAction(cardId: string, index: number, patch: Partial<Omit<CardActionRecord, "action">>): Promise<void> {
  await db
    .update(c)
    .set({ actions: sql`jsonb_set(${c.actions}, ${`{${index}}`}::text[], (${c.actions} -> ${index}::int) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(c.id, cardId));
}

export async function getCard(cardId: string): Promise<EventTaskCardRow | null> {
  const [card] = await db.select().from(c).where(eq(c.id, cardId)).limit(1);
  return card ?? null;
}

export async function setAcceptedRow(cardId: string, rowId: string): Promise<void> {
  await db.update(c).set({ acceptedRowId: rowId }).where(eq(c.id, cardId));
}

/** The project's cards for the chat: pending ones and those decided since `since`, newest first. */
export async function cardsOfProject(projectId: string, o: { readonly since: Date }): Promise<EventTaskCardRow[]> {
  return db.select().from(c).where(and(eq(c.projectId, projectId), gte(c.createdAt, o.since))).orderBy(desc(c.createdAt)).limit(50);
}

/** A task's cards still waiting for the owner: the judge is told, so it doesn't repeat one. */
export async function pendingCardsOfTask(taskId: string): Promise<EventTaskCardRow[]> {
  return db
    .select()
    .from(c)
    .where(and(eq(c.taskId, taskId), eq(c.status, "pending")))
    .orderBy(desc(c.createdAt));
}

/** The cards waiting for «Hazlo» or «Ahora no» in several projects: the phone's «Te necesita». */
export async function pendingCardsOfProjects(projectIds: readonly string[]): Promise<EventTaskCardRow[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(c)
    .where(and(inArray(c.projectId, [...projectIds]), eq(c.status, "pending")))
    .orderBy(desc(c.createdAt));
}

/** What the owner decided on a task's cards since `since`: the judge's status notice. */
export async function decisionsSince(taskId: string, since: Date): Promise<EventTaskCardRow[]> {
  return db.select().from(c).where(and(eq(c.taskId, taskId), ne(c.status, "pending"), gt(c.decidedAt, since))).orderBy(desc(c.decidedAt));
}

/** A task's latest cards, for `schedule_list`. */
export async function latestCards(taskId: string, limit: number): Promise<EventTaskCardRow[]> {
  return db.select().from(c).where(eq(c.taskId, taskId)).orderBy(desc(c.createdAt)).limit(limit);
}
