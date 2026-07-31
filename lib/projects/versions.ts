// Per-project version history — snapshot, list, fetch, restore, pin, rename.
//
// Every snapshot is scoped to one document: `page = null` is the home page
// (data.html), a slug is that site page (data.pages[slug].html). Dedup,
// eviction and restore all operate within the snapshot's own scope, so a
// /pricing version can never overwrite home and home churn can never evict
// /pricing history.
//
// Callers are expected to have verified auth/ownership before invoking
// these helpers; `listVersions`, `getVersionHtml`, `restoreVersion`, and
// `updateVersionMeta` take a `userId` and gate ownership themselves, but
// `createVersion` does NOT (the call sites are always inside
// already-authorized flows).

import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";

const VERSION_LIMIT = 50; // unpinned rows per (project, page) scope
const PIN_LIMIT = 10; // pinned rows per project
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
  page: string | null;
  pinned: boolean;
  isBaseline: boolean;
  createdAt: Date;
}

interface CreateVersionParams {
  projectId: string;
  html: string;
  label: string;
  source: VersionSource;
  /** Document scope: null/absent = home (data.html), slug = data.pages[slug]. */
  page?: string | null;
  /** When the snapshot dedups against the latest identical version, also
   *  rename that existing row to this label. Used by "save version now" so a
   *  user-typed name lands on the checkpoint even when the content already
   *  matches the newest snapshot. */
  relabelDedup?: boolean;
  /** Marca esta versión como baseline (el "original"). Default: true cuando
   *  source === "initial". Un rediseño IA completo pasa true explícito. */
  isBaseline?: boolean;
}

function scopeCondition(projectId: string, page: string | null) {
  return and(
    eq(schema.projectVersions.projectId, projectId),
    page === null
      ? isNull(schema.projectVersions.page)
      : eq(schema.projectVersions.page, page),
  );
}

/** Insert a snapshot row, then evict the oldest unpinned rows beyond
 *  VERSION_LIMIT within the same (project, page) scope. Returns the row's id.
 *  Skips if the most-recent version in the scope has identical HTML (no-op
 *  snapshot — avoids garbage entries when restore / inline-edit autosave /
 *  publish hit in quick succession). */
export async function createVersion(
  params: CreateVersionParams,
): Promise<string | null> {
  if (!params.html) return null;
  const page = params.page ?? null;
  const label = params.label.slice(0, LABEL_MAX);

  const recent = await db
    .select({
      id: schema.projectVersions.id,
      html: schema.projectVersions.html,
      label: schema.projectVersions.label,
      isBaseline: schema.projectVersions.isBaseline,
    })
    .from(schema.projectVersions)
    .where(scopeCondition(params.projectId, page))
    .orderBy(desc(schema.projectVersions.createdAt))
    .limit(1);
  const isBaseline = params.isBaseline ?? params.source === "initial";
  if (recent[0]?.html === params.html) {
    const patch: { label?: string; isBaseline?: boolean } = {};
    if (params.relabelDedup && recent[0].label !== label) patch.label = label;
    if (isBaseline && !recent[0].isBaseline) patch.isBaseline = true;
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.projectVersions)
        .set(patch)
        .where(eq(schema.projectVersions.id, recent[0].id));
    }
    return recent[0].id;
  }

  const id = crypto.randomUUID();
  await db.insert(schema.projectVersions).values({
    id,
    projectId: params.projectId,
    source: params.source,
    label,
    html: params.html,
    page,
    isBaseline,
  });

  // Evict the oldest unpinned beyond the cap, within this scope only.
  const rows = await db
    .select({ id: schema.projectVersions.id })
    .from(schema.projectVersions)
    .where(
      and(
        scopeCondition(params.projectId, page),
        eq(schema.projectVersions.pinned, false),
        eq(schema.projectVersions.isBaseline, false),
      ),
    )
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

// Generous read ceiling: per-scope caps already bound the table, this only
// guards against pathological many-page projects flooding one response.
const LIST_LIMIT = 300;

/** Verify the user owns the project, then list versions newest-first
 *  (all page scopes — the panel filters client-side). */
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
      page: schema.projectVersions.page,
      pinned: schema.projectVersions.pinned,
      isBaseline: schema.projectVersions.isBaseline,
      createdAt: schema.projectVersions.createdAt,
    })
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, params.projectId))
    .orderBy(desc(schema.projectVersions.createdAt))
    .limit(LIST_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    label: r.label,
    source: asSource(r.source),
    page: r.page,
    pinned: r.pinned,
    isBaseline: r.isBaseline,
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
  /** Scope the restore landed on: null = home, slug = that site page. */
  page: string | null;
  updatedAt: Date;
}

/** Overwrite the version's own document (home or its site page) with the
 *  snapshot, after snapshotting the current state so the restore itself is
 *  undoable. A snapshot of a since-deleted page recreates that page.
 *  Returns null if the version doesn't exist or the user doesn't own it. */
export async function restoreVersion(
  params: VersionScopedParams,
): Promise<RestoreResult | null> {
  const rows = await db
    .select({
      versionHtml: schema.projectVersions.html,
      versionLabel: schema.projectVersions.label,
      versionPage: schema.projectVersions.page,
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

  const page = row.versionPage ?? null;
  const currentHtml = page
    ? row.projectData?.pages?.[page]?.html ?? ""
    : row.projectData?.html ?? "";
  if (currentHtml && currentHtml !== row.versionHtml) {
    await createVersion({
      projectId: params.projectId,
      html: currentHtml,
      label: `Before restoring "${row.versionLabel.slice(0, 60)}"`,
      source: "restore",
      page,
    });
  }

  // Merge, don't replace: a version row stores only `html`, so restoring with
  // `{ html }` alone would wipe data.settings (per-form notify/redirect config
  // + analyticsDisabled) and sibling pages. Preserve everything else,
  // mirroring the PATCH /html route. A deleted page is recreated here — the
  // snapshot is the data; its title re-derives from the slug.
  const base: ProjectData = row.projectData ?? { html: "" };
  const nextData: ProjectData = page
    ? {
        ...base,
        pages: {
          ...base.pages,
          [page]: { ...base.pages?.[page], html: row.versionHtml },
        },
      }
    : { ...base, html: row.versionHtml };
  const now = new Date();
  await db
    .update(schema.projects)
    .set({ data: nextData, updatedAt: now })
    .where(eq(schema.projects.id, params.projectId));

  // Forward marker: the live document is now this restored version. Snapshot
  // it as the NEWEST entry so the timeline + the panel's "Current" indicator
  // point at what the user actually sees (the "Before restoring" snapshot
  // above is the older state, kept so the restore itself stays undoable).
  // Without this, the newest row is "Before restoring" yet the page matches
  // an OLDER row, so the panel mislabels the wrong snapshot as Current.
  await createVersion({
    projectId: params.projectId,
    html: row.versionHtml,
    label: `Restored "${row.versionLabel.slice(0, 60)}"`,
    source: "restore",
    page,
  });

  return { html: row.versionHtml, label: row.versionLabel, page, updatedAt: now };
}

interface UpdateVersionMetaParams extends VersionScopedParams {
  label?: string;
  pinned?: boolean;
}

export type UpdateVersionMetaResult =
  | { ok: true; label: string; pinned: boolean }
  | { ok: false; reason: "not_found" | "pin_limit" | "invalid_label" };

/** Rename and/or (un)pin a version, gated by user ownership. Pinning is
 *  capped at PIN_LIMIT per project so "pin everything" can't defeat
 *  eviction and grow rows unbounded. */
export async function updateVersionMeta(
  params: UpdateVersionMetaParams,
): Promise<UpdateVersionMetaResult> {
  const rows = await db
    .select({
      label: schema.projectVersions.label,
      pinned: schema.projectVersions.pinned,
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
  if (!row) return { ok: false, reason: "not_found" };

  const patch: { label?: string; pinned?: boolean } = {};

  if (params.label !== undefined) {
    const label = params.label.trim().slice(0, LABEL_MAX);
    if (!label) return { ok: false, reason: "invalid_label" };
    patch.label = label;
  }

  if (params.pinned !== undefined && params.pinned !== row.pinned) {
    if (params.pinned) {
      const pinnedRows = await db
        .select({ id: schema.projectVersions.id })
        .from(schema.projectVersions)
        .where(
          and(
            eq(schema.projectVersions.projectId, params.projectId),
            eq(schema.projectVersions.pinned, true),
          ),
        )
        .limit(PIN_LIMIT);
      if (pinnedRows.length >= PIN_LIMIT) {
        return { ok: false, reason: "pin_limit" };
      }
    }
    patch.pinned = params.pinned;
  }

  if (Object.keys(patch).length > 0) {
    await db
      .update(schema.projectVersions)
      .set(patch)
      .where(eq(schema.projectVersions.id, params.versionId));
  }

  return {
    ok: true,
    label: patch.label ?? row.label,
    pinned: patch.pinned ?? row.pinned,
  };
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
