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

/** Takes the project's box for `turnId`; `false` if another turn has it. */
export async function holdProjectSandbox(projectId: string, turnId: string): Promise<boolean> {
  const r = (await db.execute(sql`
    INSERT INTO "projectSandboxes" ("projectId", "heldBy") VALUES (${projectId}, ${turnId})
    ON CONFLICT ("projectId") DO UPDATE SET "heldBy" = EXCLUDED."heldBy", "updatedAt" = now()
      WHERE "projectSandboxes"."heldBy" IS NULL
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

/** Boxes paused before `cutoff` and held by nobody: the reaper's list. */
export async function pausedBefore(cutoff: Date): Promise<{ projectId: string; sandboxId: string }[]> {
  const rows = (await db.execute(sql`
    SELECT "projectId", "sandboxId" FROM "projectSandboxes"
    WHERE "state" = 'paused' AND "sandboxId" IS NOT NULL AND "heldBy" IS NULL AND "pausedAt" < ${cutoff}
    ORDER BY "pausedAt"
  `)) as unknown as { rows?: { projectId: string; sandboxId: string }[] } | { projectId: string; sandboxId: string }[];
  return (Array.isArray(rows) ? rows : (rows.rows ?? [])).map((r) => ({ projectId: r.projectId, sandboxId: r.sandboxId }));
}

/** Deletes the project's row; with `heldBy`, only while that one holds it (the reaper). */
export async function forgetProjectSandbox(projectId: string, heldBy?: string): Promise<void> {
  const byProject = eq(schema.projectSandboxes.projectId, projectId);
  await db.delete(schema.projectSandboxes).where(heldBy === undefined ? byProject : and(byProject, eq(schema.projectSandboxes.heldBy, heldBy)));
}
