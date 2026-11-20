// Postgres persistence for OpenLen Edge A/B Testing (Plan 3).
// Uses atomic compare-and-swap on `decisionStatus` (mirroring lib/assistants/requests/store.ts)
// so simultaneous clicks from Web and Mobile can never double-promote or double-rollback.
import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { HARM_NOTICE_DAYS } from "./cards";
import {
  AB_ACTIVE_STATUSES,
  AB_LIVE_STATUSES,
  AB_SYSTEM_ACTOR,
  type AbBringRowState,
  type AbBringState,
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
    // `bringing` (a bring's claim, for the seconds the merge takes) is a bring still waiting, to everyone outside.
    bringState: row.bringState === "bringing" ? "pending" : row.bringState,
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
        isNull(schema.abExperiments.notifiedAt),
        or(
          inArray(schema.abExperiments.status, ["winner_ready", "inconclusive", "paused_harm"]),
          // What the reconcile pass closed or recorded on its own (round 3, C): nobody decided it, so nobody else will tell the owner.
          and(inArray(schema.abExperiments.status, ["cancelled", "promoted_b"]), eq(schema.abExperiments.decidedBy, AB_SYSTEM_ACTOR)),
        ),
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

/** A promoted Variant B that isn't in the owner's draft yet — merge pending (a Len turn was live) or clashed with their
 *  edits — and that they haven't discarded. Their next publish would send the draft WITHOUT it, undoing the promotion:
 *  it waits for them to bring it in or discard it (the pattern of Len Watch's `pendingFix`, review item 26). */
export async function pendingBringForProject(projectId: string): Promise<AbExperimentRow | null> {
  const [row] = await db
    .select()
    .from(schema.abExperiments)
    .where(
      and(
        eq(schema.abExperiments.projectId, projectId),
        eq(schema.abExperiments.status, "promoted_b"),
        // A bring in the middle of its merge still holds the owner's publish: the draft doesn't have B yet.
        inArray(schema.abExperiments.bringState, ["pending", "conflict", "bringing"]),
      ),
    )
    .orderBy(desc(schema.abExperiments.decidedAt))
    .limit(1);
  return row ?? null;
}

/** Moves a promoted experiment's `bringState` only if it is still in one of `from` (a background bring and a person's
 *  button can race: the loser changes nothing). `null` = it didn't move. */
export async function transitionBringState(
  id: string,
  from: readonly AbBringRowState[],
  patch: Partial<Pick<AbExperimentInsert, "bringState" | "copyProjectId">>,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .update(schema.abExperiments)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.status, "promoted_b"),
        inArray(schema.abExperiments.bringState, [...from]),
      ),
    )
    .returning();
  return row ?? null;
}

/** A `bringing` claim older than this belongs to a process that died mid-merge: it can be taken again. A merge takes seconds. */
export const BRING_CLAIM_STALE_MS = 10 * 60_000;

/** A bring CLAIMS the row before it merges (review of G4+G5, minor 10): `pending`/`conflict` → `bringing`, a compare-and-swap, so a
 *  discard (which moves only from `pending`/`conflict`) that arrives meanwhile is refused, and a discard that came first leaves
 *  nothing to claim — B is never merged into a draft whose bring was declined. A `bringing` that nobody has touched for
 *  `BRING_CLAIM_STALE_MS` is a dead process's and is taken again. `null` = not claimable (settled, discarded, or being brought). */
export async function claimBring(id: string, now: Date = new Date()): Promise<AbExperimentRow | null> {
  const stale = new Date(now.getTime() - BRING_CLAIM_STALE_MS);
  const [row] = await db
    .update(schema.abExperiments)
    .set({ bringState: "bringing", updatedAt: now })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.status, "promoted_b"),
        or(
          inArray(schema.abExperiments.bringState, ["pending", "conflict"]),
          and(eq(schema.abExperiments.bringState, "bringing"), lt(schema.abExperiments.updatedAt, stale)),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** A system republish kept the live experiment alive with a NEW release: that is its release now, and the fallback it was
 *  launched with is stale — rolling back to it (keep A, a harm stop) would undo whatever the republish carried (a platform-
 *  wide fix). Cleared, the way back is a republish of the published sources, which carries it (G1+G3 review, item 18). */
export async function recordReemittedRelease(
  id: string,
  sha: string | null,
  overrides?: readonly string[],
): Promise<{ readonly recorded: boolean; readonly added: readonly string[] }> {
  const [before] = await db
    .select({ overridePaths: schema.abExperiments.overridePaths })
    .from(schema.abExperiments)
    .where(eq(schema.abExperiments.id, id))
    .limit(1);
  const rows = await db
    .update(schema.abExperiments)
    .set({
      experimentReleaseSha: sha,
      controlReleaseSha: null,
      // The new control can make other assets differ from B: the edge must be purged of whatever the CURRENT manifest names.
      ...(overrides ? { overridePaths: [...overrides] } : {}),
      updatedAt: new Date(),
    })
    // Only an experiment that is still live: one a decision closed meanwhile keeps its record (review: re-emit race).
    .where(and(eq(schema.abExperiments.id, id), inArray(schema.abExperiments.status, [...AB_LIVE_STATUSES])))
    .returning({ id: schema.abExperiments.id });
  const known = new Set(before?.overridePaths ?? []);
  return { recorded: rows.length > 0, added: (overrides ?? []).filter((p) => !known.has(p)) };
}

/** Postgres' unique_violation, however the driver wraps it (node-postgres, PGlite, drizzle's query error with a `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** The launch takes its place BEFORE it publishes: the draft becomes `running` (with no start yet) under the one-live-per-
 *  project index, so of two launches at the same instant one gets the project and the other is refused — without having
 *  written a release. `"taken"` = another experiment of the project is live; `"moved"` = this one was no longer a draft. */
export async function claimLaunch(id: string): Promise<AbExperimentRow | "taken" | "moved"> {
  try {
    const [row] = await db
      .update(schema.abExperiments)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(eq(schema.abExperiments.id, id), eq(schema.abExperiments.status, "draft")))
      .returning();
    return row ?? "moved";
  } catch (err) {
    if (isUniqueViolation(err)) return "taken";
    throw err;
  }
}

/** The launch's FINAL write is a compare-and-swap: it lands only while the row is still the launch's own claim
 *  (`running`, no start). `null` = something else settled the row meanwhile (the reconcile pass), and the caller undoes
 *  what it published. */
export async function finalizeLaunch(
  id: string,
  patch: Partial<Omit<AbExperimentInsert, "id" | "projectId" | "createdAt">>,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .update(schema.abExperiments)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.status, "running"),
        isNull(schema.abExperiments.startedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** Every live experiment of every project, the claimed launches included: what the reconcile pass looks at. */
export async function listLiveExperiments(): Promise<AbExperimentRow[]> {
  return db
    .select()
    .from(schema.abExperiments)
    .where(inArray(schema.abExperiments.status, [...AB_LIVE_STATUSES]));
}

/** A publish that failed after the claim: the experiment is a draft again, and the project has no live one. */
export async function releaseLaunch(id: string): Promise<void> {
  await db
    .update(schema.abExperiments)
    .set({ status: "draft", startedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.status, "running"),
        isNull(schema.abExperiments.startedAt),
      ),
    );
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
      // Fresh per claim: what fences the decision's heartbeat and its closing write (a lock the sweep gave back and
      // someone else took has ANOTHER token).
      decisionLockToken: randomBytes(12).toString("hex"),
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.projectId, projectId),
        // An experiment whose launch hasn't finished (no start yet) is nobody's to decide: the launch is still writing it.
        isNotNull(schema.abExperiments.startedAt),
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
export const DECISION_LOCK_CLEARED = { decisionPrevStatus: null, decisionLockedAt: null, decisionLockToken: null } as const;

/** The decision that holds the lock says it is alive: `decisionLockedAt` moves to `now`, ONLY while the row is still
 *  `applying` under THIS token. `false` = the lock is no longer its (the sweep gave it back, or someone else took it). */
export async function heartbeatDecisionLock(id: string, token: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(schema.abExperiments)
    .set({ decisionLockedAt: now })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.decisionStatus, "applying"),
        eq(schema.abExperiments.decisionLockToken, token),
      ),
    )
    .returning({ id: schema.abExperiments.id });
  return rows.length > 0;
}

/** A decision's closing write, FENCED on its own lock (review: stale-lock recovery): it lands only while the row is
 *  `applying` under `token`, and clears the lock with it. If it misses — the sweep gave the lock back and another
 *  decision took it — it changes nothing, says so loudly, and returns `null`: what is published stays published, and the
 *  evaluator's reconcile pass makes the row agree with the release. */
export async function closeDecision(
  id: string,
  token: string | null,
  patch: Partial<Omit<AbExperimentInsert, "id" | "projectId" | "createdAt">>,
): Promise<AbExperimentRow | null> {
  const [row] = token
    ? await db
        .update(schema.abExperiments)
        .set({ ...patch, ...DECISION_LOCK_CLEARED, updatedAt: new Date() })
        .where(
          and(
            eq(schema.abExperiments.id, id),
            eq(schema.abExperiments.decisionStatus, "applying"),
            eq(schema.abExperiments.decisionLockToken, token),
          ),
        )
        .returning()
    : [];
  if (!row) {
    // eslint-disable-next-line no-console
    console.error(`[ab] a decision's closing write MISSED (its lock was taken over or lost): ${id} — nothing was overwritten`);
  }
  return row ?? null;
}

/** The decision status an `applying` row goes back to: the one it had when it was claimed; a row with no memory of it (a
 *  lock from before the column) derives it — a running experiment had no decision, one that reached a verdict had a
 *  pending one. */
const previousDecisionStatus = () =>
  sql`COALESCE(${schema.abExperiments.decisionPrevStatus}, CASE WHEN ${schema.abExperiments.status} = 'running' THEN 'none' ELSE 'pending' END)`;

/** A decision that failed gives the lock back AS IT WAS (review item 20): a failed promote of a pending winner is still
 *  pending — the card and the morning summary keep showing it — and an early decision of a running test is still none.
 *  Only an `applying` row is touched. */
export async function releaseDecisionLock(id: string, token?: string | null): Promise<void> {
  await db
    .update(schema.abExperiments)
    .set({ decisionStatus: previousDecisionStatus(), ...DECISION_LOCK_CLEARED, updatedAt: new Date() })
    .where(
      and(
        eq(schema.abExperiments.id, id),
        eq(schema.abExperiments.decisionStatus, "applying"),
        // Fenced when the caller holds a token: it never gives back a lock that is another decision's now.
        ...(token ? [eq(schema.abExperiments.decisionLockToken, token)] : []),
      ),
    );
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
        // TOLD ONCE: the summary lists a decision only until it has said it (it marks it with `notifiedAt` after sending);
        // before, a verdict nobody answered was repeated every single morning (review item 29). The card stays on screen.
        isNull(schema.abExperiments.notifiedAt),
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
      ...(snap?.stats.reason ? { reason: snap.stats.reason } : {}),
      winnerVariant: exp.winnerVariant ?? null,
      rateA,
      rateB,
      liftPct,
      totalViews,
      probability,
    };
  });
}

/** The cards a person's screens show for these projects: the decisions waiting for them AND the experiments the harm brake
 *  stopped in the last `HARM_NOTICE_DAYS` — the push and the email of a harm stop open a screen, and it has to show what
 *  they talk about (review item 23). A harm stop has no decision to take: the view says `paused_harm`, resolved. */
export async function pendingExperimentViewsForProjects(
  projectIds: readonly string[],
  now: Date = new Date(),
): Promise<AbExperimentView[]> {
  if (projectIds.length === 0) return [];
  const harmSince = new Date(now.getTime() - HARM_NOTICE_DAYS * 86_400_000);
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
        or(
          and(
            eq(schema.abExperiments.decisionStatus, "pending"),
            inArray(schema.abExperiments.status, ["winner_ready", "inconclusive"]),
          ),
          and(eq(schema.abExperiments.status, "paused_harm"), gte(schema.abExperiments.endedAt, harmSince)),
        ),
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
  return closeLiveExperiment(id, {
    status: "cancelled",
    decisionStatus: "resolved",
    copyProjectId: null,
    endedAt: now,
    decidedAt: now,
    decidedBy: actorId,
  });
}

/** Closes a LIVE experiment nobody is deciding, with the patch the caller says (cancelled, or a promotion the reconcile pass
 *  records). A compare-and-swap on both: still live, and no decision applying. `null` = it wasn't ours to close. */
export async function closeLiveExperiment(
  id: string,
  patch: Partial<Omit<AbExperimentInsert, "id" | "projectId" | "createdAt">>,
): Promise<AbExperimentRow | null> {
  const [row] = await db
    .update(schema.abExperiments)
    .set({ ...patch, updatedAt: new Date() })
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
