// The real terminal's box per project, in Postgres (spec local 2026-10-21-real-terminal-e2b, §4):
// which E2B box is the project's, whether it runs or sleeps, what it had in common with the saved
// copy when it paused, and which turn holds it. One turn at a time: holding is a compare-and-set,
// and a project without a box yet is held by creating its row.

import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { Manifest } from "./manifest";

export interface ProjectSandboxRow {
  readonly projectId: string;
  readonly sandboxId: string | null;
  readonly template: string | null;
  readonly state: "none" | "running" | "paused";
  readonly syncedManifest: Manifest;
  readonly heldBy: string | null;
  readonly pausedAt: Date | null;
}

export async function getProjectSandbox(projectId: string): Promise<ProjectSandboxRow | null> {
  const [row] = await db.select().from(schema.projectSandboxes).where(eq(schema.projectSandboxes.projectId, projectId)).limit(1);
  return row ?? null;
}

/** A hold this old belongs to a turn that died with the app (a deploy, a crash): its `finally` never ran.
 *  No turn lasts this long, and E2B paused its box long before (15 minutes without an extension). */
const STALE_HOLD = sql`interval '2 hours'`;

/** Takes the project's box for `turnId`; `false` if another (living) turn has it. */
export async function holdProjectSandbox(projectId: string, turnId: string): Promise<boolean> {
  const r = (await db.execute(sql`
    INSERT INTO "projectSandboxes" ("projectId", "heldBy") VALUES (${projectId}, ${turnId})
    ON CONFLICT ("projectId") DO UPDATE SET "heldBy" = EXCLUDED."heldBy", "updatedAt" = now()
      WHERE "projectSandboxes"."heldBy" IS NULL OR "projectSandboxes"."updatedAt" < now() - ${STALE_HOLD}
    RETURNING "projectId"
  `)) as unknown as { rows?: unknown[] } | unknown[];
  return (Array.isArray(r) ? r : (r.rows ?? [])).length > 0;
}

/** Saves the box's state; who holds it is not touched (that is hold/release). */
export async function saveProjectSandbox(row: {
  readonly projectId: string;
  readonly sandboxId: string;
  readonly template: string;
  readonly state: "running" | "paused";
  readonly syncedManifest: Manifest;
  readonly pausedAt: Date | null;
}): Promise<void> {
  const values = {
    sandboxId: row.sandboxId,
    template: row.template,
    state: row.state,
    syncedManifest: { ...row.syncedManifest },
    pausedAt: row.pausedAt,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.projectSandboxes)
    .values({ projectId: row.projectId, ...values })
    .onConflictDoUpdate({ target: schema.projectSandboxes.projectId, set: values });
}

/** How the reaper's holds start. It runs in its own process (a systemd timer), so the app restarting does not
 *  end them. */
export const REAPER_HOLD_PREFIX = "reaper-";

/** A box a turn of the previous process held when it died, as the boot found it. */
export interface DeadHold {
  readonly projectId: string;
  readonly sandboxId: string | null;
  /** The dead turn (`session.turnId`, the ledger's refId of its box charge). */
  readonly turnId: string;
  /** Who pays the box: the project's owner; `null` if the project is gone. */
  readonly ownerId: string | null;
  /** How long the box ran for that turn: from when the turn opened it (the row says `running` from then) up to
   *  this boot, the closest to its death the database knows. 0 if the turn died before opening it. */
  readonly secondsRun: number;
}

/** At boot: takes over, for `token`, every box a turn of the previous process held — a deploy or a crash killed
 *  it before its `finally` — so no new turn resumes one while the boot pauses it (the reaper's way). A hold from
 *  before this process booted is nobody's here (ONE Next process, like the turn rows); the reaper's stay. The cut is
 *  on the database's clock (now minus how long this process has lived), the clock `updatedAt` is written with. */
export async function takeOverHoldsFromBeforeBoot(secondsSinceBoot: number, token: string): Promise<DeadHold[]> {
  type Row = { projectId: string; sandboxId: string | null; turnId: string; ownerId: string | null; secondsRun: string | number };
  const bootedAt = sql`now() - (${secondsSinceBoot}::double precision * interval '1 second')`;
  const r = (await db.execute(sql`
    WITH dead AS (
      SELECT "projectId", "sandboxId", "heldBy", "state", "updatedAt" FROM "projectSandboxes"
      WHERE "heldBy" IS NOT NULL AND "heldBy" NOT LIKE ${`${REAPER_HOLD_PREFIX}%`} AND "updatedAt" < ${bootedAt}
      FOR UPDATE
    )
    UPDATE "projectSandboxes" AS b SET "heldBy" = ${token}, "updatedAt" = now()
    FROM dead WHERE b."projectId" = dead."projectId"
    RETURNING dead."projectId", dead."sandboxId", dead."heldBy" AS "turnId",
      (SELECT p."userId" FROM "projects" AS p WHERE p."id" = dead."projectId") AS "ownerId",
      CASE WHEN dead."state" = 'running' AND dead."sandboxId" IS NOT NULL
        THEN GREATEST(0, EXTRACT(EPOCH FROM ${bootedAt} - dead."updatedAt")) ELSE 0 END AS "secondsRun"
  `)) as unknown as { rows?: Row[] } | Row[];
  return (Array.isArray(r) ? r : (r.rows ?? [])).map((x) => ({
    projectId: x.projectId,
    sandboxId: x.sandboxId,
    turnId: x.turnId,
    ownerId: x.ownerId,
    secondsRun: Number(x.secondsRun),
  }));
}

/** The boot paused the dead turn's box: the row says so, and lets it go. Only while `token` holds it. */
export async function releasePausedBox(projectId: string, token: string): Promise<void> {
  await db.execute(sql`
    UPDATE "projectSandboxes" SET "state" = 'paused', "pausedAt" = now(), "heldBy" = NULL, "updatedAt" = now()
    WHERE "projectId" = ${projectId} AND "heldBy" = ${token}
  `);
}

/** Lets go of the box, only if `turnId` is the one holding it. */
export async function releaseProjectSandbox(projectId: string, turnId: string): Promise<void> {
  await db.execute(sql`
    UPDATE "projectSandboxes" SET "heldBy" = NULL, "updatedAt" = now()
    WHERE "projectId" = ${projectId} AND "heldBy" = ${turnId}
  `);
}

export interface IdleSandbox {
  readonly projectId: string;
  readonly sandboxId: string;
  readonly pausedAt: Date | null;
}

/** The reaper's list: boxes unused since before `cutoff` — paused then, or left running by a turn that
 *  died — that no living turn holds. */
export async function idleBefore(cutoff: Date): Promise<IdleSandbox[]> {
  type Row = { projectId: string; sandboxId: string; pausedAt: Date | string | null };
  const rows = (await db.execute(sql`
    SELECT "projectId", "sandboxId", "pausedAt" FROM "projectSandboxes"
    WHERE "sandboxId" IS NOT NULL
      AND COALESCE("pausedAt", "updatedAt") < ${cutoff}
      AND ("heldBy" IS NULL OR "updatedAt" < now() - ${STALE_HOLD})
    ORDER BY COALESCE("pausedAt", "updatedAt")
  `)) as unknown as { rows?: Row[] } | Row[];
  return (Array.isArray(rows) ? rows : (rows.rows ?? [])).map((r) => ({
    projectId: r.projectId,
    sandboxId: r.sandboxId,
    pausedAt: r.pausedAt === null ? null : new Date(r.pausedAt),
  }));
}

/** Deletes the project's row; with `heldBy`, only while that one holds it (the reaper). */
export async function forgetProjectSandbox(projectId: string, heldBy?: string): Promise<void> {
  const byProject = eq(schema.projectSandboxes.projectId, projectId);
  await db.delete(schema.projectSandboxes).where(heldBy === undefined ? byProject : and(byProject, eq(schema.projectSandboxes.heldBy, heldBy)));
}
