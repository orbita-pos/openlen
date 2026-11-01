// LEN WATCH's rows (spec local 2026-10-30-len-watch): the owner's switches and the incidents.
// One active incident per project, kept by a partial unique index (scripts/len-watch-migrate-sql.ts):
// `openIncident` inserts with ON CONFLICT DO NOTHING, so 500 visitors racing open exactly one.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { BringState, Incident, IncidentStatus, LenWatchSettings, Resolution, WatchReport } from "./types";

const DEFAULTS: LenWatchSettings = { autoFix: false, autoPublish: false, muted: false, locale: null };

/** Resolved incidents are kept this long; whoever opens a new one prunes the older ones. */
const KEEP_RESOLVED_DAYS = 90;

export async function getSettings(projectId: string): Promise<LenWatchSettings> {
  const [row] = await db.select().from(schema.lenWatchSettings).where(eq(schema.lenWatchSettings.projectId, projectId)).limit(1);
  if (!row) return { ...DEFAULTS };
  return { autoFix: row.autoFix, autoPublish: row.autoFix && row.autoPublish, muted: row.muted, locale: row.locale ?? null };
}

/** Merges the patch into the saved switches. Publishing alone needs fixing alone: without it, it goes off. */
export async function saveSettings(projectId: string, patch: Partial<LenWatchSettings>): Promise<LenWatchSettings> {
  const merged = { ...(await getSettings(projectId)), ...patch };
  const next: LenWatchSettings = { ...merged, autoPublish: merged.autoFix && merged.autoPublish };
  await db
    .insert(schema.lenWatchSettings)
    .values({ projectId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.lenWatchSettings.projectId, set: { ...next, updatedAt: new Date() } });
  return next;
}

type IncidentRow = typeof schema.lenWatchIncidents.$inferSelect;

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    sample: row.sample,
    reports: row.reports,
    summary: row.summary ?? null,
    reason: row.reason ?? null,
    shipsUnpublished: row.shipsUnpublished,
    turnRowId: row.turnRowId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt ?? null,
    resolution: row.resolution ?? null,
    fixStamp: row.fixStamp ?? null,
    copyProjectId: row.copyProjectId ?? null,
    branch: row.branch ?? null,
    base: row.base ?? null,
    bringState: row.bringState ?? null,
  };
}

export async function activeIncident(projectId: string): Promise<Incident | null> {
  const [row] = await db
    .select()
    .from(schema.lenWatchIncidents)
    .where(and(eq(schema.lenWatchIncidents.projectId, projectId), ne(schema.lenWatchIncidents.status, "resolved")))
    .limit(1);
  return row ? toIncident(row) : null;
}

/** The incidents of several projects resolved since `since`, newest first (the phone's «Tareas ·
 *  Resueltas», spec local 2026-10-31-len-movil, §5.4). */
export async function resolvedSince(projectIds: readonly string[], since: Date): Promise<Incident[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.lenWatchIncidents)
    .where(and(inArray(schema.lenWatchIncidents.projectId, [...projectIds]), eq(schema.lenWatchIncidents.status, "resolved"), gte(schema.lenWatchIncidents.resolvedAt, since)))
    .orderBy(desc(schema.lenWatchIncidents.resolvedAt));
  return rows.map(toIncident);
}

export async function incidentById(id: string): Promise<Incident | null> {
  const [row] = await db.select().from(schema.lenWatchIncidents).where(eq(schema.lenWatchIncidents.id, id)).limit(1);
  return row ? toIncident(row) : null;
}

/** The project's incidents whose published fix the owner hasn't brought into the draft (spec §5.5), newest first. */
export async function pendingBrings(projectId: string): Promise<Incident[]> {
  const rows = await db
    .select()
    .from(schema.lenWatchIncidents)
    .where(and(eq(schema.lenWatchIncidents.projectId, projectId), eq(schema.lenWatchIncidents.bringState, "pending")))
    .orderBy(sql`${schema.lenWatchIncidents.createdAt} desc`);
  return rows.map(toIncident);
}

/** Opens the project's incident, or returns null when one is already active (someone else won the race). */
export async function openIncident(projectId: string, sample: WatchReport): Promise<Incident | null> {
  await db
    .delete(schema.lenWatchIncidents)
    .where(
      and(
        isNotNull(schema.lenWatchIncidents.resolvedAt),
        lt(schema.lenWatchIncidents.resolvedAt, sql`now() - make_interval(days => ${KEEP_RESOLVED_DAYS})`),
      ),
    );
  const rows = await db
    .insert(schema.lenWatchIncidents)
    .values({ id: crypto.randomUUID(), projectId, sample })
    .onConflictDoNothing()
    .returning();
  return rows[0] ? toIncident(rows[0]) : null;
}

/** Adds `n` visitor reports to the incident (the ingester counts some in memory and adds them at once). */
export async function countReport(incidentId: string, n = 1): Promise<void> {
  await db
    .update(schema.lenWatchIncidents)
    .set({ reports: sql`${schema.lenWatchIncidents.reports} + ${n}` })
    .where(eq(schema.lenWatchIncidents.id, incidentId));
}

export async function updateIncident(
  id: string,
  patch: Partial<{ status: Exclude<IncidentStatus, "resolved">; summary: string | null; reason: string | null; shipsUnpublished: boolean; turnRowId: string | null; fixStamp: string | null; copyProjectId: string | null; branch: string | null; base: string | null; bringState: BringState | null }>,
): Promise<void> {
  await db
    .update(schema.lenWatchIncidents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.lenWatchIncidents.id, id));
}

/** «Fix with Len» takes the incident in ONE statement: the route only read the status, and OpenLen spends seconds
 *  looking at the page before `startFix` writes «fixing», so two clicks could start two fixes (a real incident,
 *  31/10). `false`: someone else has it, or it isn't in a status Len may be asked from. */
export async function claimFix(id: string, from: readonly IncidentStatus[]): Promise<boolean> {
  const rows = await db
    .update(schema.lenWatchIncidents)
    .set({ status: "fixing", reason: null, updatedAt: new Date() })
    .where(and(eq(schema.lenWatchIncidents.id, id), inArray(schema.lenWatchIncidents.status, [...from])))
    .returning({ id: schema.lenWatchIncidents.id });
  return rows.length > 0;
}

/** The claim back, when the fix couldn't start: only while no turn has its row (one that started keeps it). */
export async function releaseFix(id: string, to: IncidentStatus): Promise<void> {
  await db
    .update(schema.lenWatchIncidents)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(schema.lenWatchIncidents.id, id), eq(schema.lenWatchIncidents.status, "fixing"), isNull(schema.lenWatchIncidents.turnRowId)));
}

export async function resolveIncident(id: string, resolution: Resolution): Promise<void> {
  const now = new Date();
  await db
    .update(schema.lenWatchIncidents)
    .set({ status: "resolved", resolution, resolvedAt: now, updatedAt: now })
    .where(eq(schema.lenWatchIncidents.id, id));
}
