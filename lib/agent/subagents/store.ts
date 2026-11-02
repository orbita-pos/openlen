// LEN'S SUBAGENTS IN POSTGRES (spec local 2026-11-01-subagentes-de-len, §4.7, table `subagentRuns`):
// a row per child, written when it starts, as it goes and when it ends. Its notice is marked delivered
// once, with compare-and-set, so a restart never hands it to Len twice.
import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
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
}

export type NewSubagentRun = Pick<SubagentRunRow, "id" | "projectId" | "chatRowId" | "turnId" | "personId" | "preset" | "description" | "prompt">;

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

export async function runsOfRow(projectId: string, chatRowId: string): Promise<SubagentRunRow[]> {
  return (await db.select().from(t).where(and(eq(t.projectId, projectId), eq(t.chatRowId, chatRowId))).orderBy(asc(t.createdAt), asc(t.id))) as SubagentRunRow[];
}

export async function runById(id: string): Promise<SubagentRunRow | null> {
  const [r] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  return (r as SubagentRunRow | undefined) ?? null;
}

/** What a previous process left running (boot). */
export async function runningRuns(): Promise<SubagentRunRow[]> {
  return (await db.select().from(t).where(eq(t.status, "running")).orderBy(asc(t.createdAt), asc(t.id))) as SubagentRunRow[];
}

/** Settled runs of a project whose notice never reached Len. */
export async function undeliveredSettledRuns(projectId: string): Promise<SubagentRunRow[]> {
  return (await db
    .select()
    .from(t)
    .where(and(eq(t.projectId, projectId), ne(t.status, "running"), isNull(t.noticeDeliveredAt)))
    .orderBy(asc(t.settledAt), asc(t.id))) as SubagentRunRow[];
}
