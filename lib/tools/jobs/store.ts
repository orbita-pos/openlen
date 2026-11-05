// WHERE A TOOL'S JOBS LIVE (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): one row per job, DeepSeek's
// registry contract (packages/jobs/jobs, at fcc0ad4621, MIT) — settlement is first-wins (a second `settleJob` changes
// nothing), cancellation is a request (`running → stopping`) the runner honours, and only the owner reads a job.
import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { DeliveredFile, JobUpload, ToolJobStatus, ToolJobView } from "./types";

export type ToolJobRow = typeof schema.toolJobs.$inferSelect;

const j = schema.toolJobs;
const LIVE: readonly ToolJobStatus[] = ["running", "stopping"];

export function toJobView(row: ToolJobRow): ToolJobView {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    status: row.status,
    progress: row.progress,
    detail: row.detail,
    result: row.result ?? null,
    delivered: row.delivered ?? [],
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    seconds: row.seconds,
    chargedCentis: row.chargedCentis,
  };
}

export async function insertJob(input: {
  readonly id: string;
  readonly personId: string;
  readonly toolProjectId: string;
  readonly installationId: string | null;
  readonly releaseSha: string | null;
  readonly name: string;
  readonly title: string;
  readonly input: unknown;
  readonly uploads: readonly JobUpload[];
}): Promise<ToolJobRow> {
  const [row] = await db
    .insert(j)
    .values({ ...input, uploads: [...input.uploads], status: "running" })
    .returning();
  if (!row) throw new Error("toolJobs: the insert returned no row");
  return row;
}

export async function jobById(id: string): Promise<ToolJobRow | null> {
  const [row] = await db.select().from(j).where(eq(j.id, id)).limit(1);
  return row ?? null;
}

/** A person's jobs of one tool, newest first. */
export function jobsOf(personId: string, toolProjectId: string, limit: number): Promise<ToolJobRow[]> {
  return db
    .select()
    .from(j)
    .where(and(eq(j.personId, personId), eq(j.toolProjectId, toolProjectId)))
    .orderBy(desc(j.startedAt))
    .limit(limit);
}

/** The job's live progress line, while it works. */
export async function setProgress(id: string, line: string): Promise<void> {
  await db
    .update(j)
    .set({ progress: line.slice(0, 200) })
    .where(and(eq(j.id, id), inArray(j.status, [...LIVE])));
}

/** DeepSeek's cancellation request: `running → stopping`; the job settles as `killed` once its work stops. */
export async function requestCancel(id: string): Promise<ToolJobRow | null> {
  const [row] = await db.update(j).set({ status: "stopping" }).where(and(eq(j.id, id), eq(j.status, "running"))).returning();
  return row ?? null;
}

/** Settles a live job once; null when it was already settled. */
export async function settleJob(
  id: string,
  status: Exclude<ToolJobStatus, "running" | "stopping">,
  set: {
    readonly detail?: string | null;
    readonly result?: unknown;
    readonly delivered?: readonly DeliveredFile[];
    readonly seconds?: number;
    readonly chargedCentis?: number;
  },
): Promise<ToolJobRow | null> {
  const [row] = await db
    .update(j)
    .set({
      status,
      finishedAt: sql`now()`,
      ...(set.detail !== undefined ? { detail: set.detail } : {}),
      ...(set.result !== undefined ? { result: set.result } : {}),
      ...(set.delivered !== undefined ? { delivered: [...set.delivered] } : {}),
      ...(set.seconds !== undefined ? { seconds: set.seconds } : {}),
      ...(set.chargedCentis !== undefined ? { chargedCentis: set.chargedCentis } : {}),
    })
    .where(and(eq(j.id, id), inArray(j.status, [...LIVE])))
    .returning();
  return row ?? null;
}

/** Jobs still running or stopping: a restart settles the ones from before it. */
export function runningJobs(): Promise<ToolJobRow[]> {
  return db.select().from(j).where(inArray(j.status, [...LIVE]));
}

/** At boot: the live jobs started before this process booted — their runner died with it (ONE Next process, like the
 *  turn rows). The cut is on the database's clock: now minus how long this process has lived. */
export function liveJobsFromBeforeBoot(secondsSinceBoot: number): Promise<ToolJobRow[]> {
  return db
    .select()
    .from(j)
    .where(and(inArray(j.status, [...LIVE]), sql`${j.startedAt} < now() - (${secondsSinceBoot}::double precision * interval '1 second')`));
}

/** Who a job is for — who pays its box. */
export async function jobPersonOf(id: string): Promise<string | null> {
  const [row] = await db.select({ personId: j.personId }).from(j).where(eq(j.id, id)).limit(1);
  return row?.personId ?? null;
}
