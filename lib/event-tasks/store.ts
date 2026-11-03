// WHERE EVENT TASKS LIVE (spec local 2026-11-03-len-que-avisa, §7.1, §7.9, §7.10): Postgres is the truth, like
// the scheduled tasks beside them. A check is CLAIMED with compare-and-swap on `nextCheckAt` before anything
// observes the source, so two passes never observe the same task at once; a delivered record stays `pending`
// until its judge ran, so a restart judges it once (DeepSeek's run records end at delivery).
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, isNull, lt, lte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { MAX_ACTIVE_TASKS_PER_PROJECT, OpenLenScheduleError } from "@/lib/scheduled-tasks/limits";

export type EventSourceKind = "app_rows" | "form_submissions";
export type EventTaskRow = typeof schema.eventTasks.$inferSelect;
export type EventTaskRecordRow = typeof schema.eventTaskRecords.$inferSelect;
export type EventTaskCardRow = typeof schema.eventTaskCards.$inferSelect;

/** Judging turns per task per day (spec §7.10): a source that changes a lot can't spend the owner's credits. */
export const EVENT_TASK_DAILY_JUDGES = 24;
/** How often a source is looked at: the Super-agent prototype's default. */
export const CHECK_EVERY_MS = 60_000;

const DAY_MS = 86_400_000;
const RECORD_KEEP_MS = 30 * DAY_MS;
const RECORDS_PER_TASK = 200;

const t = schema.eventTasks;
const r = schema.eventTaskRecords;

/** Active tasks of both kinds: the ten per project are shared (spec §7.10). */
export async function countActiveTasks(projectId: string): Promise<number> {
  const [scheduled] = await db
    .select({ n: count() })
    .from(schema.scheduledTasks)
    .where(and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.status, "active")));
  const [events] = await db.select({ n: count() }).from(t).where(and(eq(t.projectId, projectId), eq(t.status, "active")));
  return Number(scheduled?.n ?? 0) + Number(events?.n ?? 0);
}

export async function createEventTask(input: {
  readonly projectId: string;
  readonly createdBy: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly title: string;
  readonly prompt: string;
  readonly source: EventSourceKind;
  readonly params: Record<string, unknown>;
  readonly state: Record<string, unknown>;
  readonly now: Date;
}): Promise<EventTaskRow> {
  if ((await countActiveTasks(input.projectId)) >= MAX_ACTIVE_TASKS_PER_PROJECT) {
    throw new OpenLenScheduleError(
      "too_many_schedules",
      `This project already has ${MAX_ACTIVE_TASKS_PER_PROJECT} active scheduled tasks. Delete one before creating another.`,
    );
  }
  const { now, ...values } = input;
  const [row] = await db
    .insert(t)
    // Its first check is the watcher's next pass; the source's state already starts at what exists now.
    .values({ ...values, id: randomUUID(), nextCheckAt: now, createdAt: now, updatedAt: now })
    .returning();
  return row!;
}

export async function listEventTasks(projectId: string, o: { readonly includeInactive?: boolean } = {}): Promise<EventTaskRow[]> {
  return db
    .select()
    .from(t)
    .where(o.includeInactive ? eq(t.projectId, projectId) : and(eq(t.projectId, projectId), eq(t.status, "active")))
    .orderBy(asc(t.createdAt), asc(t.id));
}

export async function getEventTask(projectId: string, id: string): Promise<EventTaskRow | null> {
  const [row] = await db.select().from(t).where(and(eq(t.projectId, projectId), eq(t.id, id))).limit(1);
  return row ?? null;
}

export async function getEventTaskById(id: string): Promise<EventTaskRow | null> {
  const [row] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  return row ?? null;
}

export async function updateEventTask(projectId: string, id: string, patch: { readonly title?: string; readonly prompt?: string }, now: Date): Promise<EventTaskRow | null> {
  const [row] = await db.update(t).set({ ...patch, updatedAt: now }).where(and(eq(t.projectId, projectId), eq(t.id, id))).returning();
  return row ?? null;
}

export async function deleteEventTask(projectId: string, id: string): Promise<boolean> {
  return (await db.delete(t).where(and(eq(t.projectId, projectId), eq(t.id, id))).returning({ id: t.id })).length > 0;
}

export async function deactivateEventTask(id: string, now: Date): Promise<void> {
  await db.update(t).set({ status: "inactive", updatedAt: now }).where(eq(t.id, id));
}

export async function pauseEventTask(projectId: string, id: string, now: Date): Promise<EventTaskRow | null> {
  const [row] = await db.update(t).set({ pausedAt: now, updatedAt: now }).where(and(eq(t.projectId, projectId), eq(t.id, id))).returning();
  return row ?? null;
}

export async function resumeEventTask(projectId: string, id: string, now: Date): Promise<EventTaskRow | null> {
  const [row] = await db.update(t).set({ pausedAt: null, nextCheckAt: now, updatedAt: now }).where(and(eq(t.projectId, projectId), eq(t.id, id))).returning();
  return row ?? null;
}

/** The tasks due a check, each claimed once: its `nextCheckAt` moves a minute on only if it is still as read. */
export async function claimDueChecks(now: Date, limit: number): Promise<EventTaskRow[]> {
  const due = await db
    .select()
    .from(t)
    .where(and(eq(t.status, "active"), isNull(t.pausedAt), lte(t.nextCheckAt, now)))
    .orderBy(asc(t.nextCheckAt))
    .limit(limit);
  const claimed: EventTaskRow[] = [];
  for (const task of due) {
    const [row] = await db
      .update(t)
      .set({ nextCheckAt: new Date(now.getTime() + CHECK_EVERY_MS), lastCheckedAt: now })
      // In milliseconds, JS's precision, as the scheduled tasks' claim.
      .where(and(eq(t.id, task.id), sql`date_trunc('milliseconds', ${t.nextCheckAt}) = ${task.nextCheckAt}`, eq(t.status, "active"), isNull(t.pausedAt)))
      .returning();
    if (row) claimed.push(row);
  }
  return claimed;
}

export async function saveObservation(taskId: string, state: Record<string, unknown>, at: Date): Promise<void> {
  await db.update(t).set({ state, lastCheckedAt: at, updatedAt: at }).where(eq(t.id, taskId));
}

/** The judge's conversation after a turn, and when it ran. */
export async function saveTranscript(taskId: string, transcript: unknown[], at: Date): Promise<void> {
  await db.update(t).set({ transcript, lastJudgedAt: at }).where(eq(t.id, taskId));
}

/** One record per change or failure; a failure with the same cause as the task's newest record adds to its count. */
export async function writeRecord(o: {
  readonly taskId: string;
  readonly projectId: string;
  readonly kind: EventTaskRecordRow["kind"];
  readonly reason?: string | null;
  readonly candidate?: Record<string, unknown> | null;
  /** How many changes it stands for: the filtered ones of one check share a record per reason. */
  readonly count?: number;
  readonly at: Date;
}): Promise<EventTaskRecordRow> {
  if (o.kind === "failed") {
    const [last] = await db.select().from(r).where(eq(r.taskId, o.taskId)).orderBy(desc(r.lastAt), desc(r.firstAt)).limit(1);
    if (last?.kind === "failed" && last.reason === (o.reason ?? null)) {
      const [row] = await db.update(r).set({ count: sql`${r.count} + 1`, lastAt: o.at }).where(eq(r.id, last.id)).returning();
      return row!;
    }
  }
  const [row] = await db
    .insert(r)
    .values({
      id: randomUUID(),
      taskId: o.taskId,
      projectId: o.projectId,
      kind: o.kind,
      reason: o.reason ?? null,
      count: o.count ?? 1,
      candidate: o.candidate ?? null,
      judge: o.kind === "delivered" ? "pending" : null,
      firstAt: o.at,
      lastAt: o.at,
    })
    .returning();
  return row!;
}

export async function recordsOf(taskId: string, limit: number): Promise<EventTaskRecordRow[]> {
  return db.select().from(r).where(eq(r.taskId, taskId)).orderBy(desc(r.lastAt)).limit(limit);
}

/** Delivered records whose judge never finished: a restart judges them once. */
export async function pendingJudges(): Promise<EventTaskRecordRow[]> {
  return db.select().from(r).where(eq(r.judge, "pending")).orderBy(asc(r.firstAt));
}

export async function markJudged(recordId: string, notified: boolean): Promise<void> {
  await db.update(r).set({ judge: "done", notified }).where(eq(r.id, recordId));
}

/** One judging turn of the day for this task, or false past `EVENT_TASK_DAILY_JUDGES`; a new day starts at one. */
export async function takeJudgeSlot(taskId: string, day: string): Promise<boolean> {
  const rows = await db
    .update(t)
    .set({ judgeDay: day, judgesThatDay: sql`CASE WHEN ${t.judgeDay} = ${day} THEN ${t.judgesThatDay} + 1 ELSE 1 END` })
    .where(and(eq(t.id, taskId), sql`(${t.judgeDay} IS DISTINCT FROM ${day} OR ${t.judgesThatDay} < ${EVENT_TASK_DAILY_JUDGES})`))
    .returning({ id: t.id });
  return rows.length > 0;
}

/** Records have their own bounds (spec §7.9): 30 days, and the newest 200 of each task. */
export async function purgeOldRecords(now: Date): Promise<void> {
  await db.delete(r).where(lt(r.lastAt, new Date(now.getTime() - RECORD_KEEP_MS)));
  await db.execute(sql`
    DELETE FROM ${r} WHERE ${r.id} IN (
      SELECT "id" FROM (
        SELECT "id", row_number() OVER (PARTITION BY "taskId" ORDER BY "lastAt" DESC, "firstAt" DESC) AS rn FROM ${r}
      ) ranked WHERE ranked.rn > ${RECORDS_PER_TASK}
    )`);
}
