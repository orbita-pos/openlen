// WHERE THE WORKSPACE'S THEMES LIVE (spec local 2026-11-27-temas-del-workspace, §12.1): Postgres is the truth. A release
// is immutable and keyed by its sha, its scenes already checked and kept as text; an installation is one row per person
// and theme project; a choice is one row per person and scope («everywhere» or a project). Nothing here decides which
// theme wins — that is the resolver's — it only keeps what was installed and what was picked.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { SceneCost } from "./scene-check";
import { EVERYWHERE_SCOPE, type StoredThemeDefinition, type ThemeChoices } from "./types";

export type ThemeInstallationRow = typeof schema.themeInstallations.$inferSelect;

/** What an install writes: the manifest's themes with each scene as its checked SVG text, what each scene costs, the
 *  glass opacity the contrast gate raised (by theme id; absent = as the manifest declared), and what each scene measured
 *  under Len's panel (by the sha256 of its checked SVG; absent = not measured). */
export interface ThemeReleaseInput {
  sha: string;
  projectId: string;
  themes: StoredThemeDefinition[];
  costs: Record<string, SceneCost>;
  glassAdjusted: Record<string, number>;
  measured: Record<string, string>;
  /** Themes (by id) whose declared tint the gate ignored for the workspace's own surface (`fitThemeGlass`). */
  tintIgnored: Record<string, true>;
}

export interface ThemeRelease extends ThemeReleaseInput {
  createdAt: Date;
}

/** A stored theme as the LIST needs it: everything but the scene's text, and whether it has one. */
export type ThemeMeta = Omit<StoredThemeDefinition, "scene"> & { hasScene: boolean };

/** A version as the picker and the resolver read it: no scene text in it — that is read only to serve a scene. */
export interface ThemeReleaseMeta {
  sha: string;
  projectId: string;
  themes: ThemeMeta[];
  costs: Record<string, SceneCost>;
  glassAdjusted: Record<string, number>;
  tintIgnored: Record<string, true>;
}

const r = schema.themeReleases;
const i = schema.themeInstallations;
const c = schema.workspaceThemeChoices;

/** Keeps a version. A version never changes — its sha names its content — so a second save of the same sha does nothing. */
export async function saveThemeRelease(release: ThemeReleaseInput): Promise<void> {
  await db
    .insert(r)
    .values({
      sha: release.sha,
      projectId: release.projectId,
      themes: release.themes,
      costs: release.costs,
      glassAdjusted: release.glassAdjusted,
      measured: release.measured,
      tintIgnored: release.tintIgnored,
    })
    .onConflictDoNothing({ target: r.sha });
}

/**
 * Deletes a project's versions that no installation points at — anyone's, a removed one's included (its row stays and a
 * reinstall moves it) — so reinstalling does not pile up every old version with its scenes' full text. How many went.
 */
export async function pruneThemeReleases(projectId: string): Promise<number> {
  const pointed = db.select({ sha: i.releaseSha }).from(i).where(eq(i.projectId, projectId));
  const rows = await db
    .delete(r)
    .where(and(eq(r.projectId, projectId), notInArray(r.sha, pointed)))
    .returning({ sha: r.sha });
  return rows.length;
}

/** A version, or null when there is none (its project was deleted, or the sha was never saved). */
export async function readThemeRelease(sha: string): Promise<ThemeRelease | null> {
  const [row] = await db.select().from(r).where(eq(r.sha, sha)).limit(1);
  if (!row) return null;
  return {
    sha: row.sha,
    projectId: row.projectId,
    themes: row.themes,
    costs: row.costs,
    glassAdjusted: row.glassAdjusted,
    measured: row.measured,
    tintIgnored: row.tintIgnored,
    createdAt: row.createdAt,
  };
}

/**
 * A version without its scenes' text: the list (`GET /api/themes`, on every load of /new) needs each theme's title,
 * window, glass and twin, never the SVG — which can be hundreds of KB a theme. Postgres drops `scene` from each theme
 * before anything leaves the database, in the themes' order, and says whether there was one. Null when there is none.
 */
export async function readThemeReleaseMeta(sha: string): Promise<ThemeReleaseMeta | null> {
  const [row] = await db
    .select({
      sha: r.sha,
      projectId: r.projectId,
      themes: sql<ThemeMeta[]>`(
        SELECT coalesce(jsonb_agg((t.theme - 'scene') || jsonb_build_object('hasScene', t.theme ? 'scene') ORDER BY t.at), '[]'::jsonb)
        FROM jsonb_array_elements(${r.themes}) WITH ORDINALITY AS t(theme, at)
      )`,
      costs: r.costs,
      glassAdjusted: r.glassAdjusted,
      tintIgnored: r.tintIgnored,
    })
    .from(r)
    .where(eq(r.sha, sha))
    .limit(1);
  return row ?? null;
}

/** What the scenes of a project's latest version measured (scene sha256 → colour), or nothing when it has none. */
export async function latestThemeMeasurements(projectId: string): Promise<Record<string, string>> {
  const [row] = await db.select({ measured: r.measured }).from(r).where(eq(r.projectId, projectId)).orderBy(desc(r.createdAt)).limit(1);
  return row?.measured ?? {};
}

/**
 * Installs a theme project for a person, or moves their installation to a new version: one row per person and
 * project, so the id a choice names (`installed:<id>:<themeId>`) survives every reinstall — and so does a removed
 * row's, which this brings back (`removedAt` goes null).
 */
export async function upsertThemeInstallation(input: {
  readonly personId: string;
  readonly projectId: string;
  readonly releaseSha: string;
}): Promise<ThemeInstallationRow> {
  const now = new Date();
  const [row] = await db
    .insert(i)
    .values({
      id: randomUUID(),
      personId: input.personId,
      projectId: input.projectId,
      releaseSha: input.releaseSha,
      installedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [i.personId, i.projectId],
      set: { releaseSha: input.releaseSha, updatedAt: now, removedAt: null },
    })
    .returning();
  if (!row) throw new Error("themeInstallations: the upsert returned no row");
  return row;
}

/** Every installation of a person, oldest first (two of the same instant by id, so the order never changes between
 *  reads), removed ones included (the page offers to bring them back). */
export async function listThemeInstallations(personId: string): Promise<ThemeInstallationRow[]> {
  return db.select().from(i).where(eq(i.personId, personId)).orderBy(asc(i.installedAt), asc(i.id));
}

/** Marks a person's installation removed, keeping the row. Whether it was theirs to remove: false for another person's or none. */
export async function markThemeRemoved(id: string, personId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(i)
    .set({ removedAt: now, updatedAt: now })
    .where(and(eq(i.id, id), eq(i.personId, personId)))
    .returning({ id: i.id });
  return rows.length > 0;
}

/**
 * Sets what a person picked for a scope — `"everywhere"` or a project's id — replacing the one that was there; `null`
 * clears it. Each scope is its own row: clearing a project's pick leaves «everywhere» as it was.
 */
export async function setThemeChoice(personId: string, scope: string, themeRef: string | null): Promise<void> {
  if (themeRef === null) {
    await db.delete(c).where(and(eq(c.personId, personId), eq(c.scope, scope)));
    return;
  }
  const now = new Date();
  await db
    .insert(c)
    .values({ personId, scope, themeRef, updatedAt: now })
    .onConflictDoUpdate({ target: [c.personId, c.scope], set: { themeRef, updatedAt: now } });
}

/** A person's picks for a project (`null` = none open, so only «everywhere» is read): the project's own, and «everywhere». */
export async function themeChoicesOf(personId: string, projectId: string | null): Promise<ThemeChoices> {
  // A project's id is never the literal «everywhere» — but if one were, it must not read that row as its own.
  const own = projectId !== null && projectId !== EVERYWHERE_SCOPE ? projectId : null;
  const scopes = own === null ? [EVERYWHERE_SCOPE] : [EVERYWHERE_SCOPE, own];
  const rows = await db
    .select({ scope: c.scope, themeRef: c.themeRef })
    .from(c)
    .where(and(eq(c.personId, personId), inArray(c.scope, scopes)));
  const choices: ThemeChoices = { project: null, everywhere: null };
  for (const row of rows) {
    if (row.scope === EVERYWHERE_SCOPE) choices.everywhere = row.themeRef;
    else choices.project = row.themeRef;
  }
  return choices;
}
