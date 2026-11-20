// Postgres persistence for OpenLen Edge A/B Testing (Plan 3).
// Uses atomic compare-and-swap on `decisionStatus` (mirroring lib/assistants/requests/store.ts)
// so simultaneous clicks from Web and Mobile can never double-promote or double-rollback.
import "server-only";

import { and, desc, eq, inArray, or } from "drizzle-orm";

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

/** Atomic compare-and-swap lock for deciding an experiment (promote_b / keep_a / extend).
 *  Accepts experiments in `pending` OR `none` (when the owner manually decides early)
 *  and moves `decisionStatus` to `applying` exactly once. Returns null if another caller won. */
export async function claimExperimentDecision(
  id: string,
  projectId: string,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .update(schema.abExperiments)
    .set({ decisionStatus: "applying", updatedAt: new Date() })
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

export async function releaseDecisionLock(
  id: string,
  restoreStatus: AbDecisionStatus = "pending",
): Promise<void> {
  await db
    .update(schema.abExperiments)
    .set({ decisionStatus: restoreStatus, updatedAt: new Date() })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.decisionStatus, "applying"),
      ),
    );
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
