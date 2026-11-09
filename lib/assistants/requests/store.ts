// WHAT VISITORS ASK FOR AND SHE CAN'T DO (spec local 2026-11-06-asistente-propio, §4.3, §6.5): the rows `note_request`
// leaves, and the cards a grouping turn joins them into («5 clientes preguntaron por envíos»). Visitors' data: only her
// person reads them, they never reach the box (invariant 5), and only that person's press turns a card into a Len turn.
import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { VISIT_RETENTION_DAYS } from "../visitor/store";
import { DISMISSED_JOIN_DAYS, REQUESTS_PER_ASSISTANT_DAY, REQUESTS_PER_VISIT_DAY } from "./limits";

export type RequestRow = typeof schema.assistantRequests.$inferSelect;
export type RequestCardRow = typeof schema.assistantRequestCards.$inferSelect;

const r = schema.assistantRequests;
const c = schema.assistantRequestCards;
const DAY = 86_400_000;
/** The cards a grouping turn is shown, the newest. */
const JOINABLE_MAX = 30;

const waiting = () => and(isNull(r.cardId), isNull(r.discardedAt));

/** One thing a visitor wanted. Past the day's limits nothing is stored: a visit notes at most 3 a day, and the assistant
 *  200 across her projects — a script with many visitor ids fills no more. Notes of one assistant take turns on her
 *  row, so two at once can't both slip under a limit. */
export async function noteRequest(o: {
  assistantId: string;
  projectId: string;
  visitorId: string;
  text: string;
  locale: string;
  at: Date;
}): Promise<"noted" | "visit_limit" | "assistant_limit"> {
  const since = new Date(o.at.getTime() - DAY);
  return db.transaction(async (tx) => {
    await tx.select({ id: schema.assistants.id }).from(schema.assistants).where(eq(schema.assistants.id, o.assistantId)).for("update");
    const [visit] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .where(and(eq(r.assistantId, o.assistantId), eq(r.projectId, o.projectId), eq(r.visitorId, o.visitorId), gt(r.at, since)));
    if ((visit?.n ?? 0) >= REQUESTS_PER_VISIT_DAY) return "visit_limit";
    const [all] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .where(and(eq(r.assistantId, o.assistantId), gt(r.at, since)));
    if ((all?.n ?? 0) >= REQUESTS_PER_ASSISTANT_DAY) return "assistant_limit";
    await tx.insert(r).values({ assistantId: o.assistantId, projectId: o.projectId, visitorId: o.visitorId, text: o.text, locale: o.locale, at: o.at });
    return "noted";
  });
}

/** The (assistant, project) pairs with requests waiting, whose oldest waiting one is older than `quietBefore`: a burst
 *  of visitors ends on one card. The longest waiting first. */
export async function pendingGroups(quietBefore: Date, limit: number): Promise<{ assistantId: string; projectId: string }[]> {
  return db
    .select({ assistantId: r.assistantId, projectId: r.projectId })
    .from(r)
    .where(waiting())
    .groupBy(r.assistantId, r.projectId)
    .having(sql`min(${r.at}) < ${quietBefore.toISOString()}::timestamptz`)
    .orderBy(sql`min(${r.at})`)
    .limit(limit);
}

/** A pair's waiting requests, the oldest first. */
export async function pendingRequests(assistantId: string, projectId: string, limit: number): Promise<RequestRow[]> {
  return db
    .select()
    .from(r)
    .where(and(eq(r.assistantId, assistantId), eq(r.projectId, projectId), waiting()))
    .orderBy(asc(r.at), asc(r.id))
    .limit(limit);
}

/** A card a grouping may add to: one waiting, or one the owner dismissed within 30 days (it grows in silence). */
const joinable = (now: Date) =>
  or(eq(c.status, "pending"), and(eq(c.status, "dismissed"), gte(c.decidedAt, new Date(now.getTime() - DISMISSED_JOIN_DAYS * DAY))));

/** The cards a grouping turn is shown, the newest first. */
export async function joinableCards(assistantId: string, projectId: string, now: Date): Promise<RequestCardRow[]> {
  return db
    .select()
    .from(c)
    .where(and(eq(c.assistantId, assistantId), eq(c.projectId, projectId), joinable(now)))
    .orderBy(desc(c.lastAt), desc(c.createdAt))
    .limit(JOINABLE_MAX);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function recount(tx: Tx, cardId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(distinct ${r.visitorId})::int` }).from(r).where(eq(r.cardId, cardId));
  return row?.n ?? 0;
}

/** What a grouping turn decided (lib/assistants/requests/grouping.ts), in one transaction. Only requests of that pair
 *  still waiting move, each once: a pass that read before another saved moves nothing twice, a card is made only
 *  with a request on it, and a join to a card decided meanwhile leaves its requests waiting. A card counts PEOPLE:
 *  the same visitor asking five times is one. Returns the cards that gained a request, with how many people they had
 *  before. */
export async function saveGrouping(o: {
  assistantId: string;
  projectId: string;
  locale: string;
  at: Date;
  newCards: readonly { title: string; requestIds: readonly string[] }[];
  joins: readonly { cardId: string; requestIds: readonly string[] }[];
  discard: readonly string[];
  retry: readonly string[];
}): Promise<{ card: RequestCardRow; isNew: boolean; before: number }[]> {
  const named = [...new Set([...o.newCards.flatMap((n) => n.requestIds), ...o.joins.flatMap((j) => j.requestIds), ...o.discard, ...o.retry])];
  return db.transaction(async (tx) => {
    const open = named.length
      ? await tx
          .select({ id: r.id })
          .from(r)
          .where(and(inArray(r.id, named), eq(r.assistantId, o.assistantId), eq(r.projectId, o.projectId), waiting()))
          .for("update")
      : [];
    const free = new Set(open.map((x) => x.id));
    const take = (ids: readonly string[]) => ids.filter((id) => free.delete(id));
    const out: { card: RequestCardRow; isNew: boolean; before: number }[] = [];

    // The same card named twice is one join.
    const joins = new Map<string, string[]>();
    for (const j of o.joins) joins.set(j.cardId, [...(joins.get(j.cardId) ?? []), ...j.requestIds]);
    for (const [cardId, requestIds] of joins) {
      const [card] = await tx
        .select()
        .from(c)
        .where(and(eq(c.id, cardId), eq(c.assistantId, o.assistantId), eq(c.projectId, o.projectId), joinable(o.at)))
        .for("update");
      if (!card) continue;
      const ids = take(requestIds);
      if (ids.length === 0) continue;
      await tx.update(r).set({ cardId }).where(inArray(r.id, ids));
      const [updated] = await tx.update(c).set({ visitors: await recount(tx, cardId), lastAt: o.at }).where(eq(c.id, cardId)).returning();
      out.push({ card: updated!, isNew: false, before: card.visitors });
    }

    for (const n of o.newCards) {
      const ids = take(n.requestIds);
      if (ids.length === 0) continue;
      const [card] = await tx
        .insert(c)
        .values({ assistantId: o.assistantId, projectId: o.projectId, title: n.title, locale: o.locale, createdAt: o.at, lastAt: o.at })
        .returning();
      await tx.update(r).set({ cardId: card!.id }).where(inArray(r.id, ids));
      const [counted] = await tx.update(c).set({ visitors: await recount(tx, card!.id) }).where(eq(c.id, card!.id)).returning();
      out.push({ card: counted!, isNew: true, before: 0 });
    }

    const discard = take(o.discard);
    if (discard.length) await tx.update(r).set({ discardedAt: o.at }).where(inArray(r.id, discard));
    const retry = take(o.retry);
    if (retry.length) await tx.update(r).set({ attempts: sql`${r.attempts} + 1` }).where(inArray(r.id, retry));
    return out;
  });
}

/** Forgets what is 90 days quiet (spec §6.5): a card with no request joined and no decision in that time, with its
 *  requests, and requests that never reached a card. A live card keeps its requests, so its count never drops. */
export async function pruneRequests(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - VISIT_RETENTION_DAYS * DAY);
  const stale = and(lt(c.lastAt, cutoff), or(isNull(c.decidedAt), lt(c.decidedAt, cutoff)));
  await db.transaction(async (tx) => {
    await tx.delete(r).where(or(and(isNull(r.cardId), lt(r.at, cutoff)), inArray(r.cardId, tx.select({ id: c.id }).from(c).where(stale))));
    await tx.delete(c).where(stale);
  });
}
