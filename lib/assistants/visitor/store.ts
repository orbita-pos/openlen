// THE VISITORS' SIDE OF THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.4.5, §4.7, §6.5, §6.6):
// whether it is on a project's page and what it knows of it, each visitor's conversation, and what the account's
// visitors spent this month. Visits are visitors' data: only its person reads them, and they never reach the box.
import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { AssistantRow } from "../store";

export type VisitLine = schema.AssistantVisitLine;
export type VisitRow = typeof schema.assistantVisits.$inferSelect;

/** A visit is forgotten 90 days after its last message (spec §6.5, like the step rows). */
export const VISIT_RETENTION_DAYS = 90;

const ap = schema.assistantProjects;
const v = schema.assistantVisits;
const m = schema.assistantVisitorMonths;

export async function assistantOnPage(projectId: string): Promise<{ assistant: AssistantRow; knowledge: string | null } | null> {
  const [row] = await db
    .select({ assistant: schema.assistants, knowledge: ap.knowledge })
    .from(ap)
    .innerJoin(schema.assistants, eq(schema.assistants.id, ap.assistantId))
    .where(and(eq(ap.projectId, projectId), eq(ap.onPage, true)))
    .limit(1);
  return row ? { assistant: row.assistant, knowledge: row.knowledge } : null;
}

/** `false` when that assistant isn't the one of that project. When it CHANGES she forgets what she knew: she answers
 *  visitors only after a publish with her (which bakes her bubble), never through a bubble that isn't hers yet. The same
 *  value again (a stale second tab) changes nothing, so her live bubble stays. */
export async function setOnPage(projectId: string, assistantId: string, onPage: boolean): Promise<boolean> {
  const done = await db
    .update(ap)
    .set({
      onPage,
      knowledge: sql`case when ${ap.onPage} = ${onPage} then ${ap.knowledge} else null end`,
      knowledgeAt: sql`case when ${ap.onPage} = ${onPage} then ${ap.knowledgeAt} else null end`,
    })
    .where(and(eq(ap.projectId, projectId), eq(ap.assistantId, assistantId)))
    .returning({ projectId: ap.projectId });
  return done.length > 0;
}

export async function saveKnowledge(projectId: string, text: string, at: Date): Promise<void> {
  await db.update(ap).set({ knowledge: text, knowledgeAt: at }).where(eq(ap.projectId, projectId));
}

export async function visitOf(assistantId: string, projectId: string, visitorId: string): Promise<VisitRow | null> {
  const [row] = await db
    .select()
    .from(v)
    .where(and(eq(v.assistantId, assistantId), eq(v.projectId, projectId), eq(v.visitorId, visitorId)))
    .limit(1);
  return row ?? null;
}

/** One more message of a visitor: its new lines appended, the model's trimmed transcript replaced, count and spend
 *  added; and, in the same transaction, the assistant's visits quiet for 90 days are forgotten. */
export async function saveVisit(o: {
  assistantId: string;
  projectId: string;
  visitorId: string;
  transcript: unknown[];
  newLines: VisitLine[];
  centicredits: number;
  handedOff: boolean;
  at: Date;
}): Promise<void> {
  const centicredits = Math.max(0, Math.round(o.centicredits));
  await db.transaction(async (tx) => {
    await tx
      .insert(v)
      .values({
        assistantId: o.assistantId,
        projectId: o.projectId,
        visitorId: o.visitorId,
        startedAt: o.at,
        lastAt: o.at,
        messageCount: 1,
        centicredits,
        handedOff: o.handedOff,
        transcript: o.transcript,
        lines: o.newLines,
      })
      .onConflictDoUpdate({
        target: [v.assistantId, v.projectId, v.visitorId],
        set: {
          lastAt: o.at,
          messageCount: sql`${v.messageCount} + 1`,
          centicredits: sql`${v.centicredits} + ${centicredits}`,
          handedOff: sql`${v.handedOff} or ${o.handedOff}`,
          transcript: sql`excluded."transcript"`,
          lines: sql`${v.lines} || excluded."lines"`,
        },
      });
    const cutoff = new Date(o.at.getTime() - VISIT_RETENTION_DAYS * 86_400_000);
    await tx.delete(v).where(and(eq(v.assistantId, o.assistantId), lt(v.lastAt, cutoff)));
  });
}

/** The newest first, never one quiet for 90 days: reading forgets those too, so the promise holds for an assistant
 *  whose page went quiet (no new message runs the prune in `saveVisit`). */
export async function visitsOf(assistantId: string, limit: number, now: Date = new Date()): Promise<VisitRow[]> {
  const cutoff = new Date(now.getTime() - VISIT_RETENTION_DAYS * 86_400_000);
  await db.delete(v).where(and(eq(v.assistantId, assistantId), lt(v.lastAt, cutoff)));
  return db.select().from(v).where(and(eq(v.assistantId, assistantId), gte(v.lastAt, cutoff))).orderBy(desc(v.lastAt)).limit(limit);
}

export async function monthSpent(userId: string, month: string): Promise<number> {
  const [row] = await db.select({ c: m.centicredits }).from(m).where(and(eq(m.userId, userId), eq(m.month, month))).limit(1);
  return row?.c ?? 0;
}

/** One visitor message's cost, and +1 message. */
export async function addMonthSpend(userId: string, month: string, centicredits: number): Promise<void> {
  const c = Math.max(0, Math.round(centicredits));
  await db
    .insert(m)
    .values({ userId, month, centicredits: c, messages: 1 })
    .onConflictDoUpdate({ target: [m.userId, m.month], set: { centicredits: sql`${m.centicredits} + ${c}`, messages: sql`${m.messages} + 1` } });
}

/** True ONCE per month and reason: the owner hears «she fell asleep» once (Task 9). */
export async function claimAsleepAlert(userId: string, month: string, reason: "cap" | "credits"): Promise<boolean> {
  await db.insert(m).values({ userId, month }).onConflictDoNothing();
  const won = await db
    .update(m)
    .set({ asleepAlerts: sql`${m.asleepAlerts} || ${JSON.stringify([reason])}::jsonb` })
    .where(and(eq(m.userId, userId), eq(m.month, month), sql`not (${m.asleepAlerts} @> ${JSON.stringify([reason])}::jsonb)`))
    .returning({ userId: m.userId });
  return won.length > 0;
}

export async function explicitVisitorCap(userId: string): Promise<number | null> {
  const [row] = await db.select({ cap: schema.users.assistantVisitorCap }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row?.cap ?? null;
}

export async function setExplicitVisitorCap(userId: string, cap: number | null): Promise<void> {
  await db.update(schema.users).set({ assistantVisitorCap: cap }).where(eq(schema.users.id, userId));
}
