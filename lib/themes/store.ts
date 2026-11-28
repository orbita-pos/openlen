// WHERE THE WORKSPACE'S THEMES LIVE (spec local 2026-11-27-temas-del-workspace, §12.1): Postgres is the truth. A release
// is immutable and keyed by its sha, its scenes already checked and kept as text; an installation is one row per person
// and theme project; a choice is one row per person and scope («everywhere» or a project). Nothing here decides which
// theme wins — that is the resolver's — it only keeps what was installed and what was picked.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { SceneCost } from "./scene-check";
import { EVERYWHERE_SCOPE, type StoredThemeDefinition, type ThemeChoices } from "./types";

export type ThemeInstallationRow = typeof schema.themeInstallations.$inferSelect;

/** What an install writes: the manifest's themes with each scene as its checked SVG text, what each scene costs, and the
 *  glass opacity the contrast gate raised (by theme id; absent = as the manifest declared). */
export interface ThemeReleaseInput {
  sha: string;
  projectId: string;
  themes: StoredThemeDefinition[];
  costs: Record<string, SceneCost>;
  glassAdjusted: Record<string, number>;
}

export interface ThemeRelease extends ThemeReleaseInput {
  createdAt: Date;
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
    createdAt: row.createdAt,
  };
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

/** Every installation of a person, oldest first, removed ones included (the page offers to bring them back). */
export async function listThemeInstallations(personId: string): Promise<ThemeInstallationRow[]> {
  return db.select().from(i).where(eq(i.personId, personId)).orderBy(asc(i.installedAt));
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
