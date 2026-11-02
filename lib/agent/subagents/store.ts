// LEN'S SUBAGENTS IN POSTGRES (spec local 2026-11-01-subagentes-de-len, §4.7, table `subagentRuns`):
// a row per child, written when it starts, as it goes and when it ends. Its notice is marked delivered
// once, with compare-and-set, so a restart never hands it to Len twice. Since phase 2 a settled child can be
// reopened (`send_message` wakes it from its transcript): the same row runs again.
import "server-only";
import { and, asc, eq, getTableColumns, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";

import type { SubagentStatus, SubagentStopReason } from "./notice";

export type { SubagentStatus } from "./notice";

const t = schema.subagentRuns;

export interface SubagentRunRow {
  readonly id: string;
  readonly projectId: string;
  readonly chatRowId: string;
  readonly turnId: string;
  readonly personId: string;
  readonly preset: string;
  readonly description: string;
  readonly prompt: string;
  readonly status: SubagentStatus;
  readonly transcript: unknown;
  readonly actions: unknown[];
  readonly finalText: string | null;
  readonly diagnostic: string | null;
  readonly usage: unknown;
  readonly toolUses: number;
  readonly durationMs: number | null;
  readonly chargedCenticredits: number;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
  readonly noticeDeliveredAt: Date | null;
  /** Forked from Len's conversation (`subagent_fork`). */
  readonly forked: boolean;
}

export type NewSubagentRun = Pick<SubagentRunRow, "id" | "projectId" | "chatRowId" | "turnId" | "personId" | "preset" | "description" | "prompt" | "forked">;

/** What Len's list of his children needs of each (`list_agents`, `interrupt_agent`). */
export type ConversationRun = Pick<SubagentRunRow, "id" | "description" | "preset">;

/** A card's run: all but what only a wake reads (its transcript, which holds a fork's whole inherited conversation,
 *  and its task) and the usage. */
export type CardRun = Omit<SubagentRunRow, "transcript" | "prompt" | "usage">;
const { transcript: _transcript, prompt: _prompt, usage: _usage, ...CARD_COLUMNS } = getTableColumns(t);

export interface SettledRun {
  readonly status: SubagentStopReason;
  readonly finalText: string;
  readonly diagnostic: string | null;
  readonly transcript: unknown;
  readonly actions: unknown[];
  readonly usage: unknown;
  readonly toolUses: number;
  readonly durationMs: number;
  readonly chargedCenticredits: number;
}

export async function createRun(r: NewSubagentRun): Promise<void> {
  await db.insert(t).values({ ...r, status: "running" });
}

export async function saveProgress(id: string, p: { transcript: unknown; actions: unknown[]; toolUses: number }): Promise<void> {
  await db.update(t).set({ transcript: p.transcript, actions: p.actions, toolUses: p.toolUses }).where(and(eq(t.id, id), eq(t.status, "running")));
}

export async function settleRun(id: string, s: SettledRun): Promise<void> {
  await db
    .update(t)
    .set({ ...s, settledAt: new Date() })
    .where(eq(t.id, id));
}

/** True only for the call that marked it: the notice goes once. */
export async function markNoticeDelivered(id: string): Promise<boolean> {
  const marked = await db
    .update(t)
    .set({ noticeDeliveredAt: new Date() })
    .where(and(eq(t.id, id), isNull(t.noticeDeliveredAt)))
    .returning({ id: t.id });
  return marked.length > 0;
}

export async function runsOfRow(projectId: string, chatRowId: string): Promise<CardRun[]> {
  return (await db.select(CARD_COLUMNS).from(t).where(and(eq(t.projectId, projectId), eq(t.chatRowId, chatRowId))).orderBy(asc(t.createdAt), asc(t.id))) as CardRun[];
}

/** The runs a later turn woke (`send_message`): they hang from the row that launched them. Oldest first. */
export async function runsByIds(projectId: string, ids: readonly string[]): Promise<CardRun[]> {
  if (ids.length === 0) return [];
  return (await db.select(CARD_COLUMNS).from(t).where(and(eq(t.projectId, projectId), inArray(t.id, [...ids]))).orderBy(asc(t.createdAt), asc(t.id))) as CardRun[];
}

export async function runById(id: string): Promise<SubagentRunRow | null> {
  const [r] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  return (r as SubagentRunRow | undefined) ?? null;
}

/** A settled run runs again (`send_message` woke it), as whoever woke it — their ■ stops it now: true only for the
 *  call that reopened it. */
export async function reopenRun(id: string, personId: string): Promise<boolean> {
  const reopened = await db
    .update(t)
    .set({ status: "running", settledAt: null, noticeDeliveredAt: null, personId })
    .where(and(eq(t.id, id), ne(t.status, "running")))
    .returning({ id: t.id });
  return reopened.length > 0;
}

/** Len's children: the runs launched from rows of the project's current conversation, oldest first. */
export async function runsOfCurrentConversation(projectId: string): Promise<ConversationRun[]> {
  const m = schema.projectChatMessages;
  return (await db
    .select({ id: t.id, description: t.description, preset: t.preset })
    .from(t)
    .innerJoin(m, eq(m.id, t.chatRowId))
    .where(and(eq(t.projectId, projectId), isNull(m.conversation)))
    .orderBy(asc(t.createdAt), asc(t.id))) as ConversationRun[];
}

/** One of Len's children, whole (a wake reads its transcript); null when it is not one of the current conversation. */
export async function runOfCurrentConversation(projectId: string, id: string): Promise<SubagentRunRow | null> {
  const m = schema.projectChatMessages;
  const [r] = await db
    .select(getTableColumns(t))
    .from(t)
    .innerJoin(m, eq(m.id, t.chatRowId))
    .where(and(eq(t.projectId, projectId), eq(t.id, id), isNull(m.conversation)))
    .limit(1);
  return (r as SubagentRunRow | undefined) ?? null;
}

/** What a previous process left running (boot). */
export async function runningRuns(): Promise<SubagentRunRow[]> {
  return (await db.select().from(t).where(eq(t.status, "running")).orderBy(asc(t.createdAt), asc(t.id))) as SubagentRunRow[];
}

/** Settled runs whose notice never reached Len: a project's, or every project's (the boot cleanup). */
export async function undeliveredSettledRuns(projectId?: string): Promise<SubagentRunRow[]> {
  return (await db
    .select()
    .from(t)
    .where(and(...(projectId === undefined ? [] : [eq(t.projectId, projectId)]), ne(t.status, "running"), isNull(t.noticeDeliveredAt)))
    .orderBy(asc(t.settledAt), asc(t.id))) as SubagentRunRow[];
}
