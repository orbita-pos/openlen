// Postgres persistence for OpenLen Edge A/B Testing (Plan 3).
// Uses atomic compare-and-swap on `decisionStatus` (mirroring lib/assistants/requests/store.ts)
// so simultaneous clicks from Web and Mobile can never double-promote or double-rollback.
import "server-only";

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import {
  AB_ACTIVE_STATUSES,
  AB_LIVE_STATUSES,
  type AbDecisionStatus,
  type AbExperimentStatus,
  type AbExperimentView,
  type AbPrimaryMetric,
  type AbReadySummary,
} from "./types";

export type AbExperimentRow = typeof schema.abExperiments.$inferSelect;
export type AbExperimentInsert = typeof schema.abExperiments.$inferInsert;

export function toExperimentView(
  row: AbExperimentRow,
  projectTitle?: string,
): AbExperimentView {
  return {
    id: row.id,
    projectId: row.projectId,
    ...(projectTitle !== undefined ? { projectTitle } : {}),
    assistantId: row.assistantId,
    name: row.name,
    hypothesis: row.hypothesis,
    targetPath: row.targetPath,
    includeLocales: row.includeLocales,
    primaryMetric: row.primaryMetric,
    splitBps: row.splitBps,
    status: row.status,
    decisionStatus: row.decisionStatus,
    copyProjectId: row.copyProjectId,
    bringState: row.bringState,
    winnerVariant: row.winnerVariant,
    metrics: row.metricsSnapshot ?? null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    minEndAt: row.minEndAt ? row.minEndAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    evaluatedAt: row.evaluatedAt ? row.evaluatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getExperimentById(id: string): Promise<AbExperimentRow | null> {
  const [row] = await db
    .select()
    .from(schema.abExperiments)
    .where(eq(schema.abExperiments.id, id))
    .limit(1);
  return row ?? null;
}

export async function listExperimentsForProject(
  projectId: string,
  limit = 20,
): Promise<AbExperimentRow[]> {
  return db
    .select()
    .from(schema.abExperiments)
    .where(eq(schema.abExperiments.projectId, projectId))
    .orderBy(desc(schema.abExperiments.createdAt))
    .limit(limit);
}

export async function activeExperimentForTarget(
  projectId: string,
  targetPath: string,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .select()
    .from(schema.abExperiments)
    .where(
      and(
        eq(schema.abExperiments.projectId, projectId),
        eq(schema.abExperiments.targetPath, targetPath),
        inArray(schema.abExperiments.status, [...AB_ACTIVE_STATUSES]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function liveExperimentForProject(
  projectId: string,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .select()
    .from(schema.abExperiments)
    .where(
      and(
        eq(schema.abExperiments.projectId, projectId),
        inArray(schema.abExperiments.status, [...AB_LIVE_STATUSES]),
      ),
    )
    .orderBy(desc(schema.abExperiments.startedAt))
    .limit(1);
  return row ?? null;
}

/** Experiments that ended in a verdict (a winner, no result, a harm stop) and whose owner was never told: the notice was
 *  cut between the verdict and the queue (review item 22). */
export async function listUnannouncedResults(): Promise<AbExperimentRow[]> {
  return db
    .select()
    .from(schema.abExperiments)
    .where(
      and(
        inArray(schema.abExperiments.status, ["winner_ready", "inconclusive", "paused_harm"]),
        isNull(schema.abExperiments.notifiedAt),
      ),
    );
}

/** The owner was told (the notice is in the queue). Set only AFTER it was queued. */
export async function markExperimentNotified(id: string, at: Date): Promise<void> {
  await db
    .update(schema.abExperiments)
    .set({ notifiedAt: at, updatedAt: new Date() })
    .where(eq(schema.abExperiments.id, id));
}

export async function listRunningExperiments(): Promise<AbExperimentRow[]> {
  return db
    .select()
    .from(schema.abExperiments)
    .where(eq(schema.abExperiments.status, "running"));
}

export async function createExperimentRow(
  input: Omit<AbExperimentInsert, "createdAt" | "updatedAt">,
): Promise<AbExperimentRow> {
  const [row] = await db
    .insert(schema.abExperiments)
    .values({
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("abExperiments insert returned no row");
  return row;
}

export async function updateExperiment(
  id: string,
  patch: Partial<Omit<AbExperimentInsert, "id" | "projectId" | "createdAt">>,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .update(schema.abExperiments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.abExperiments.id, id))
    .returning();
  return row ?? null;
}

/** What the evaluator may write about an experiment it just evaluated. */
export type AbEvaluationPatch = Partial<
  Pick<
    AbExperimentInsert,
    "metricsSnapshot" | "evaluatedAt" | "status" | "decisionStatus" | "winnerVariant" | "endedAt" | "notifiedAt"
  >
>;

/** The evaluator's write is a compare-and-swap (review item 21): it only lands on an experiment that is STILL running with
 *  no decision taken. A person who claimed a decision between the evaluator's read and this write wins, and the evaluator
 *  changes nothing — nothing of what follows (a notice) happens either. `true` = a row changed. */
export async function saveEvaluation(id: string, patch: AbEvaluationPatch): Promise<boolean> {
  const rows = await db
    .update(schema.abExperiments)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.status, "running"),
        eq(schema.abExperiments.decisionStatus, "none"),
      ),
    )
    .returning({ id: schema.abExperiments.id });
  return rows.length > 0;
}

/** Atomic compare-and-swap lock for deciding an experiment (promote_b / keep_a / extend).
 *  Accepts experiments in `pending` OR `none` (when the owner manually decides early)
 *  and moves `decisionStatus` to `applying` exactly once, remembering what it was (`decisionPrevStatus`, copied by the
 *  same statement: in an UPDATE every expression reads the OLD row) and when (`decisionLockedAt`). Returns null if another
 *  caller won. A decision that fails calls `releaseDecisionLock`; one that dies is found by `releaseStaleDecisionLocks`. */
export async function claimExperimentDecision(
  id: string,
  projectId: string,
): Promise<AbExperimentRow | null> {
  const now = new Date();
  const [row] = await db
    .update(schema.abExperiments)
    .set({
      decisionPrevStatus: sql`${schema.abExperiments.decisionStatus}`,
      decisionStatus: "applying",
      decisionLockedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.projectId, projectId),
        inArray(schema.abExperiments.status, [...AB_LIVE_STATUSES]),
        or(
          eq(schema.abExperiments.decisionStatus, "pending"),
          eq(schema.abExperiments.decisionStatus, "none"),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** What the lock columns are set to when a decision is over (resolved, or taken back). */
export const DECISION_LOCK_CLEARED = { decisionPrevStatus: null, decisionLockedAt: null } as const;

/** The decision status an `applying` row goes back to: the one it had when it was claimed; a row with no memory of it (a
 *  lock from before the column) derives it — a running experiment had no decision, one that reached a verdict had a
 *  pending one. */
const previousDecisionStatus = () =>
  sql`COALESCE(${schema.abExperiments.decisionPrevStatus}, CASE WHEN ${schema.abExperiments.status} = 'running' THEN 'none' ELSE 'pending' END)`;

/** A decision that failed gives the lock back AS IT WAS (review item 20): a failed promote of a pending winner is still
 *  pending — the card and the morning summary keep showing it — and an early decision of a running test is still none.
 *  Only an `applying` row is touched. */
export async function releaseDecisionLock(id: string): Promise<void> {
  await db
    .update(schema.abExperiments)
    .set({ decisionStatus: previousDecisionStatus(), ...DECISION_LOCK_CLEARED, updatedAt: new Date() })
    .where(and(eq(schema.abExperiments.id, id), eq(schema.abExperiments.decisionStatus, "applying")));
}

/** How long a decision may hold `applying` before it counts as dead (a deploy or a crash in the middle of it). */
export const STALE_DECISION_LOCK_MS = 10 * 60_000;

/** The evaluator's pass gives back the locks of decisions that died: an `applying` older than ten minutes returns to the
 *  status it had. Returns the ids it released. */
export async function releaseStaleDecisionLocks(
  now: Date = new Date(),
  olderThanMs: number = STALE_DECISION_LOCK_MS,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const rows = await db
    .update(schema.abExperiments)
    .set({ decisionStatus: previousDecisionStatus(), ...DECISION_LOCK_CLEARED, updatedAt: now })
    .where(
      and(
        eq(schema.abExperiments.decisionStatus, "applying"),
        sql`COALESCE(${schema.abExperiments.decisionLockedAt}, ${schema.abExperiments.updatedAt}) < ${cutoff}`,
      ),
    )
    .returning({ id: schema.abExperiments.id });
  return rows.map((r) => r.id);
}

/** Pending decision summaries for one or more projects (used by Morning Summary & Mobile). */
export async function pendingDecisionsForProjects(
  projectIds: readonly string[],
): Promise<AbReadySummary[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      exp: schema.abExperiments,
      projectTitle: schema.projects.title,
    })
    .from(schema.abExperiments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.abExperiments.projectId))
    .where(
      and(
        inArray(schema.abExperiments.projectId, [...projectIds]),
        eq(schema.abExperiments.decisionStatus, "pending"),
        inArray(schema.abExperiments.status, ["winner_ready", "inconclusive"]),
      ),
    )
    .orderBy(desc(schema.abExperiments.evaluatedAt));

  return rows.map(({ exp, projectTitle }) => {
    const snap = exp.metricsSnapshot;
    const rateA = snap?.a.rate ?? 0;
    const rateB = snap?.b.rate ?? 0;
    const totalViews = (snap?.a.views ?? 0) + (snap?.b.views ?? 0);
    const liftPct = Math.round((snap?.stats.relativeLift ?? 0) * 100);
    const probability =
      exp.winnerVariant === "b"
        ? (snap?.stats.probBBeatsA ?? 0)
        : exp.winnerVariant === "a"
          ? (snap?.stats.probABeatsB ?? 0)
          : Math.max(snap?.stats.probBBeatsA ?? 0, snap?.stats.probABeatsB ?? 0);
    return {
      experimentId: exp.id,
      projectId: exp.projectId,
      projectTitle: projectTitle || exp.projectId,
      name: exp.name,
      status: exp.status === "inconclusive" ? "inconclusive" : "winner_ready",
      winnerVariant: exp.winnerVariant ?? null,
      rateA,
      rateB,
      liftPct,
      totalViews,
      probability,
    };
  });
}

export async function pendingExperimentViewsForProjects(
  projectIds: readonly string[],
): Promise<AbExperimentView[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      exp: schema.abExperiments,
      projectTitle: schema.projects.title,
    })
    .from(schema.abExperiments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.abExperiments.projectId))
    .where(
      and(
        inArray(schema.abExperiments.projectId, [...projectIds]),
        eq(schema.abExperiments.decisionStatus, "pending"),
        inArray(schema.abExperiments.status, ["winner_ready", "inconclusive"]),
      ),
    )
    .orderBy(desc(schema.abExperiments.evaluatedAt));

  return rows.map(({ exp, projectTitle }) => toExperimentView(exp, projectTitle));
}

export function normalizeTargetPath(raw: string | undefined | null): string {
  if (!raw) return "/";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "/") return "/";
  const clean = trimmed.replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}` : "/";
}

export function normalizePrimaryMetric(raw: unknown): AbPrimaryMetric {
  if (raw === "form_submit" || raw === "cta_click" || raw === "conversion_any") return raw;
  return "conversion_any";
}

export function isTerminalStatus(s: AbExperimentStatus): boolean {
  return s === "promoted_b" || s === "kept_a" || s === "cancelled" || s === "paused_harm";
}

/** The owner stopped a LIVE experiment by publishing over it (review item 14): cancelled, resolved, its copy detached.
 *  Conditional on it still being live and on no decision being applied, so it never overwrites a promote or a
 *  keep-A that won the race. `null` = it wasn't ours to close. */
export async function cancelLiveExperiment(id: string, actorId: string): Promise<AbExperimentRow | null> {
  const now = new Date();
  const [row] = await db
    .update(schema.abExperiments)
    .set({
      status: "cancelled",
      decisionStatus: "resolved",
      copyProjectId: null,
      endedAt: now,
      decidedAt: now,
      decidedBy: actorId,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        inArray(schema.abExperiments.status, [...AB_LIVE_STATUSES]),
        or(eq(schema.abExperiments.decisionStatus, "pending"), eq(schema.abExperiments.decisionStatus, "none")),
      ),
    )
    .returning();
  return row ?? null;
}
