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
