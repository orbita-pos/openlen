// Per-project version history — snapshot, list, fetch, restore.
//
// Callers are expected to have verified auth/ownership before invoking
// these helpers; `listVersions`, `getVersionHtml`, and `restoreVersion`
// take a `userId` and gate ownership themselves, but `createVersion` does
// NOT (the call sites are always inside already-authorized flows).

import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";

const VERSION_LIMIT = 50;
const LABEL_MAX = 200;

export type VersionSource =
  | "initial"
  | "chat"
  | "publish"
  | "restore"
  | "manual"
  | "style-match"
  | "reorder"
  | "replace";

export interface VersionSummary {
  id: string;
  projectId: string;
  label: string;
  source: VersionSource;
  createdAt: Date;
}

interface CreateVersionParams {
  projectId: string;
  html: string;
  label: string;
  source: VersionSource;
}

/** Insert a snapshot row, then evict the oldest rows beyond VERSION_LIMIT.
 *  Returns the new row's id. Skips if the most-recent existing version has
 *  identical HTML (no-op snapshot — avoids garbage entries when restore /
 *  inline-edit autosave / publish hit in quick succession). */
export async function createVersion(
  params: CreateVersionParams,
): Promise<string | null> {
  if (!params.html) return null;

  const recent = await db
    .select({
      id: schema.projectVersions.id,
      html: schema.projectVersions.html,
    })
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, params.projectId))
    .orderBy(desc(schema.projectVersions.createdAt))
    .limit(1);
  if (recent[0]?.html === params.html) return recent[0].id;

  const id = crypto.randomUUID();
  await db.insert(schema.projectVersions).values({
    id,
    projectId: params.projectId,
    source: params.source,
    label: params.label.slice(0, LABEL_MAX),
    html: params.html,
  });

  // Evict the oldest beyond the cap.
  const rows = await db
    .select({ id: schema.projectVersions.id })
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, params.projectId))
    .orderBy(desc(schema.projectVersions.createdAt));
  if (rows.length > VERSION_LIMIT) {
    const ids = rows.slice(VERSION_LIMIT).map((r) => r.id);
    if (ids.length > 0) {
      await db
        .delete(schema.projectVersions)
        .where(inArray(schema.projectVersions.id, ids));
    }
  }
  return id;
}

interface ScopedParams {
  projectId: string;
  userId: string;
}

/** Verify the user owns the project, then list versions newest-first. */
export async function listVersions(
  params: ScopedParams,
): Promise<VersionSummary[]> {
  const owner = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, params.projectId),
        eq(schema.projects.userId, params.userId),
      ),
    )
    .limit(1);
  if (owner.length === 0) return [];

  const rows = await db
    .select({
      id: schema.projectVersions.id,
      projectId: schema.projectVersions.projectId,
      label: schema.projectVersions.label,
      source: schema.projectVersions.source,
      createdAt: schema.projectVersions.createdAt,
    })
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, params.projectId))
    .orderBy(desc(schema.projectVersions.createdAt))
    .limit(VERSION_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    label: r.label,
    source: asSource(r.source),
    createdAt: r.createdAt,
  }));
}

interface VersionScopedParams extends ScopedParams {
  versionId: string;
}

/** Fetch a single version's HTML, gated by user ownership of the project. */
export async function getVersionHtml(
  params: VersionScopedParams,
): Promise<string | null> {
  const rows = await db
    .select({ html: schema.projectVersions.html })
    .from(schema.projectVersions)
    .innerJoin(
      schema.projects,
      eq(schema.projectVersions.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.projectVersions.id, params.versionId),
        eq(schema.projectVersions.projectId, params.projectId),
        eq(schema.projects.userId, params.userId),
      ),
    )
    .limit(1);
  return rows[0]?.html ?? null;
}

interface RestoreResult {
  html: string;
  label: string;
}

/** Overwrite the project's current HTML with the version's HTML, after
 *  snapshotting the current state so the restore itself is undoable.
 *  Returns null if the version doesn't exist or the user doesn't own it. */
export async function restoreVersion(
  params: VersionScopedParams,
): Promise<RestoreResult | null> {
  const rows = await db
    .select({
      versionHtml: schema.projectVersions.html,
      versionLabel: schema.projectVersions.label,
      projectData: schema.projects.data,
    })
    .from(schema.projectVersions)
    .innerJoin(
      schema.projects,
      eq(schema.projectVersions.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.projectVersions.id, params.versionId),
        eq(schema.projectVersions.projectId, params.projectId),
        eq(schema.projects.userId, params.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const currentHtml = row.projectData?.html ?? "";
  if (currentHtml && currentHtml !== row.versionHtml) {
    await createVersion({
      projectId: params.projectId,
      html: currentHtml,
      label: `Before restoring "${row.versionLabel.slice(0, 60)}"`,
      source: "restore",
    });
  }

  const nextData: ProjectData = { html: row.versionHtml };
  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: new Date() })
    .where(eq(schema.projects.id, params.projectId));

  return { html: row.versionHtml, label: row.versionLabel };
}

function asSource(raw: string): VersionSource {
  if (
    raw === "initial" ||
    raw === "chat" ||
    raw === "publish" ||
    raw === "restore" ||
    raw === "manual" ||
    raw === "style-match" ||
    raw === "reorder" ||
    raw === "replace"
  ) {
    return raw;
  }
  return "manual";
}
