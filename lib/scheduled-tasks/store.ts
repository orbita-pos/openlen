// WHERE LEN'S SCHEDULED TASKS LIVE (spec local 2026-10-29-tareas-programadas, §7.4–7.5): Postgres is
// the truth, like DeepSeek's host store (`packages/schedule/schedule/src/storage.ts`), so a restart
// or a deploy loses nothing. A due occurrence is CLAIMED with compare-and-swap on `scheduledAt`
// before anything runs it: two passes of the scheduler, or a restart between claiming and launching,
// can never run the same occurrence twice.
import "server-only";

import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { isRecurringScheduleRecord, resolveRecurringOccurrence } from "./deepseek/domain";
import type { ScheduleRecord } from "./deepseek/types";
import { MAX_ACTIVE_TASKS_PER_PROJECT, OpenLenScheduleError } from "./limits";

export type TaskRow = typeof schema.scheduledTasks.$inferSelect;
export type RunRow = typeof schema.scheduledTaskRuns.$inferSelect;

const DAY_MS = 86_400_000;
/** Inactive tasks never show and never run again; they go after this. */
const INACTIVE_KEEP_MS = 30 * DAY_MS;
/** Runs, like `agentRequestSteps`. */
const RUN_KEEP_MS = 90 * DAY_MS;

export async function createTask(input: {
  readonly projectId: string;
  readonly createdBy: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly record: ScheduleRecord;
}): Promise<TaskRow> {
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select({ n: count() })
      .from(schema.scheduledTasks)
      .where(and(eq(schema.scheduledTasks.projectId, input.projectId), eq(schema.scheduledTasks.status, "active")));
    if ((active?.n ?? 0) >= MAX_ACTIVE_TASKS_PER_PROJECT) {
      throw new OpenLenScheduleError(
        "too_many_schedules",
        `This project already has ${MAX_ACTIVE_TASKS_PER_PROJECT} active scheduled tasks. Delete one before creating another.`,
      );
    }
    const [row] = await tx
      .insert(schema.scheduledTasks)
      .values({ ...input, id: input.record.id, scheduledAt: new Date(input.record.scheduledAt) })
      .returning();
    return row!;
  });
}

export async function listTasks(projectId: string, o: { readonly includeInactive?: boolean } = {}): Promise<TaskRow[]> {
  return db
    .select()
    .from(schema.scheduledTasks)
    .where(o.includeInactive ? eq(schema.scheduledTasks.projectId, projectId) : and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.status, "active")))
    .orderBy(asc(schema.scheduledTasks.createdAt), asc(schema.scheduledTasks.id));
}

/** The active tasks of several projects (the phone's «Tareas», spec local 2026-10-31-len-movil, §5.4). */
export async function listTasksOfProjects(projectIds: readonly string[]): Promise<TaskRow[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(schema.scheduledTasks)
    .where(and(inArray(schema.scheduledTasks.projectId, [...projectIds]), eq(schema.scheduledTasks.status, "active")))
    .orderBy(asc(schema.scheduledTasks.scheduledAt), asc(schema.scheduledTasks.id));
}

export type RunWithTask = RunRow & { readonly title: string; readonly createdBy: string };

/** The runs of several projects that finished since `since`, newest first, with their task's title and
 *  creator (the phone's «Tareas · Resueltas»). */
export async function runsSince(projectIds: readonly string[], since: Date): Promise<RunWithTask[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({ run: schema.scheduledTaskRuns, record: schema.scheduledTasks.record, createdBy: schema.scheduledTasks.createdBy })
    .from(schema.scheduledTaskRuns)
    .innerJoin(schema.scheduledTasks, eq(schema.scheduledTasks.id, schema.scheduledTaskRuns.taskId))
    .where(and(inArray(schema.scheduledTaskRuns.projectId, [...projectIds]), gte(schema.scheduledTaskRuns.finishedAt, since)))
    .orderBy(desc(schema.scheduledTaskRuns.finishedAt));
  return rows.map((r) => ({ ...r.run, title: r.record.title, createdBy: r.createdBy }));
}

export async function getTask(projectId: string, id: string): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(schema.scheduledTasks)
    .where(and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.id, id)))
    .limit(1);
  return row ?? null;
}

/** A task by its id alone: the signed «Quitar esta tarea» link carries no project. */
export async function getTaskById(id: string): Promise<TaskRow | null> {
  const [row] = await db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.id, id)).limit(1);
  return row ?? null;
}

/** Replaces the record (and its next run). With `expectedUpdatedAt`, only if nobody changed it since. A
 *  paused task stays paused, unless it becomes a one-shot: those are never paused (`pauseTask`). */
export async function updateTask(projectId: string, id: string, next: ScheduleRecord, expectedUpdatedAt?: Date): Promise<TaskRow | "not_found" | "conflict"> {
  const where = and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.id, id));
  const [row] = await db
    .update(schema.scheduledTasks)
    .set({ record: next, scheduledAt: new Date(next.scheduledAt), status: "active", updatedAt: new Date(), ...(isRecurringScheduleRecord(next) ? {} : { pausedAt: null }) })
    .where(expectedUpdatedAt ? and(where, eq(schema.scheduledTasks.updatedAt, expectedUpdatedAt)) : where)
    .returning();
  if (row) return row;
  return (await getTask(projectId, id)) ? "conflict" : "not_found";
}

export async function deleteTask(projectId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.scheduledTasks)
    .where(and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.id, id)))
    .returning({ id: schema.scheduledTasks.id });
  return rows.length > 0;
}

/** A member who leaves takes their tasks: they can no longer talk to Len there, nor get its email. */
export async function deleteTasksByCreator(projectId: string, userId: string): Promise<number> {
  const rows = await db
    .delete(schema.scheduledTasks)
    .where(and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.createdBy, userId)))
    .returning({ id: schema.scheduledTasks.id });
  return rows.length;
}

/**
 * Pauses a recurring task (spec local 2026-10-31-len-movil, §5.5): it stays `active` (listed, counted in
 * the limit of ten) but is never due. A one-shot is not paused: resumed late it would be lost quietly.
 */
export async function pauseTask(projectId: string, id: string, now: Date): Promise<TaskRow | "not_found" | "one_shot"> {
  const task = await getTask(projectId, id);
  if (!task || task.status !== "active") return "not_found";
  if (!isRecurringScheduleRecord(task.record)) return "one_shot";
  const [row] = await db
    .update(schema.scheduledTasks)
    .set({ pausedAt: now, updatedAt: now })
    .where(and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.id, id)))
    .returning();
  return row ?? "not_found";
}

/** Resumes a paused task at its next run after `now`: what it missed while paused is not run. */
export async function resumeTask(projectId: string, id: string, now: Date): Promise<TaskRow | "not_found"> {
  const task = await getTask(projectId, id);
  if (!task || task.status !== "active") return "not_found";
  if (!task.pausedAt || !isRecurringScheduleRecord(task.record)) return task;
  // A run still ahead stands (DeepSeek's resolver only answers from the saved run on).
  const next =
    Date.parse(task.record.scheduledAt) > now.getTime()
      ? task.record.scheduledAt
      : (resolveRecurringOccurrence(task.record, now.getTime()).nextScheduledAt ?? task.record.scheduledAt);
  const [row] = await db
    .update(schema.scheduledTasks)
    .set({ pausedAt: null, record: { ...task.record, scheduledAt: next } as ScheduleRecord, scheduledAt: new Date(next), updatedAt: now })
    .where(and(eq(schema.scheduledTasks.projectId, projectId), eq(schema.scheduledTasks.id, id)))
    .returning();
  return row ?? "not_found";
}

export async function dueTasks(now: Date, limit: number): Promise<TaskRow[]> {
  return db
    .select()
    .from(schema.scheduledTasks)
    .where(and(eq(schema.scheduledTasks.status, "active"), isNull(schema.scheduledTasks.pausedAt), lte(schema.scheduledTasks.scheduledAt, now)))
    .orderBy(asc(schema.scheduledTasks.scheduledAt))
    .limit(limit);
}

/**
 * Claims one occurrence of `task` as it was read: moves it to its next run (or makes it inactive when
 * there is none) and records the run, in one transaction. Null when someone else already moved it.
 */
export async function claimDue(
  task: TaskRow,
  claim: { readonly occurrenceAt: string; readonly nextScheduledAt: string | null; readonly runId: string; readonly processStartedAt: Date },
): Promise<RunRow | null> {
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(schema.scheduledTasks)
      .set(
        claim.nextScheduledAt
          ? { record: { ...task.record, scheduledAt: claim.nextScheduledAt } as ScheduleRecord, scheduledAt: new Date(claim.nextScheduledAt), lastRunId: claim.runId, updatedAt: new Date() }
          : { status: "inactive", lastRunId: claim.runId, updatedAt: new Date() },
      )
      // In milliseconds, JS's precision: a time written by SQL with microseconds must still match the
      // row as read, or that task would never be claimed (found by the end-to-end test, 29/10).
      .where(
        and(
          eq(schema.scheduledTasks.id, task.id),
          sql`date_trunc('milliseconds', ${schema.scheduledTasks.scheduledAt}) = ${task.scheduledAt}`,
          eq(schema.scheduledTasks.status, "active"),
          isNull(schema.scheduledTasks.pausedAt),
        ),
      )
      .returning({ id: schema.scheduledTasks.id });
    if (moved.length === 0) return null;
    const [run] = await tx
      .insert(schema.scheduledTaskRuns)
      .values({ id: claim.runId, taskId: task.id, projectId: task.projectId, occurrenceAt: new Date(claim.occurrenceAt), processStartedAt: claim.processStartedAt })
      .returning();
    return run!;
  });
}

export async function markRun(
  runId: string,
  patch: Partial<Pick<RunRow, "startedAt" | "finishedAt" | "outcome" | "reason" | "reply" | "emailedAt">>,
): Promise<void> {
  await db.update(schema.scheduledTaskRuns).set(patch).where(eq(schema.scheduledTaskRuns.id, runId));
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const [row] = await db.select().from(schema.scheduledTaskRuns).where(eq(schema.scheduledTaskRuns.id, runId)).limit(1);
  return row ?? null;
}

/** The task a run belongs to, wherever it is. */
export async function taskOfRun(run: RunRow): Promise<TaskRow | null> {
  return getTask(run.projectId, run.taskId);
}

export async function deactivateTask(id: string): Promise<void> {
  await db.update(schema.scheduledTasks).set({ status: "inactive", updatedAt: new Date() }).where(eq(schema.scheduledTasks.id, id));
}

export async function unfinishedRuns(): Promise<RunRow[]> {
  return db.select().from(schema.scheduledTaskRuns).where(isNull(schema.scheduledTaskRuns.finishedAt)).orderBy(asc(schema.scheduledTaskRuns.claimedAt));
}

export async function purgeOld(now: Date): Promise<void> {
  await db
    .delete(schema.scheduledTasks)
    .where(and(eq(schema.scheduledTasks.status, "inactive"), lt(schema.scheduledTasks.updatedAt, new Date(now.getTime() - INACTIVE_KEEP_MS))));
  await db.delete(schema.scheduledTaskRuns).where(lt(schema.scheduledTaskRuns.claimedAt, new Date(now.getTime() - RUN_KEEP_MS)));
}
