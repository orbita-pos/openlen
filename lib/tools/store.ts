// WHERE INSTALLED TOOLS LIVE (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.12): Postgres is the
// truth. A release is immutable and keyed by its sha; an installation is one row per person and tool project,
// whose host label is fixed for its whole life, so a reinstall keeps the address the workspace already framed.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { ToolPlacement, ToolReleaseFile } from "./types";

export type ToolInstallationRow = typeof schema.toolInstallations.$inferSelect;

const i = schema.toolInstallations;
const r = schema.toolReleases;

export async function saveRelease(sha: string, projectId: string, files: Record<string, ToolReleaseFile>): Promise<void> {
  await db.insert(r).values({ sha, projectId, files }).onConflictDoNothing({ target: r.sha });
}

export async function readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null> {
  const [row] = await db.select({ files: r.files }).from(r).where(eq(r.sha, sha)).limit(1);
  return row?.files ?? null;
}

/** The person's name, for a tool's `context()` (the workspace has no session object of its own). */
export async function personName(personId: string): Promise<string> {
  const [row] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, personId)).limit(1);
  return row?.name ?? "";
}

/** Whether a release is still there, without reading its files (the tools list asks it for every tool). */
export async function releaseExists(sha: string): Promise<boolean> {
  const [row] = await db.select({ sha: r.sha }).from(r).where(eq(r.sha, sha)).limit(1);
  return !!row;
}

export async function upsertInstallation(input: {
  readonly personId: string;
  readonly projectId: string;
  readonly releaseSha: string;
  readonly placement: ToolPlacement;
  readonly titles: Record<string, string>;
  readonly descriptions: Record<string, string>;
  readonly iconPath: string;
  /** The private host's label for a new row's id; a reinstall keeps the label it already has. */
  readonly hostLabelFor: (id: string) => string;
}): Promise<ToolInstallationRow> {
  const id = randomUUID();
  const now = new Date();
  const [row] = await db
    .insert(i)
    .values({
      id,
      personId: input.personId,
      projectId: input.projectId,
      releaseSha: input.releaseSha,
      placement: input.placement,
      titles: input.titles,
      descriptions: input.descriptions,
      iconPath: input.iconPath,
      hostLabel: input.hostLabelFor(id),
      installedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [i.personId, i.projectId],
      set: {
        releaseSha: input.releaseSha,
        placement: input.placement,
        titles: input.titles,
        descriptions: input.descriptions,
        iconPath: input.iconPath,
        updatedAt: now,
        removedAt: null,
      },
    })
    .returning();
  if (!row) throw new Error("toolInstallations: the upsert returned no row");
  return row;
}

/** Every installation of a person, removed ones included (the page offers «Restaurar»). */
export async function listInstallations(personId: string): Promise<ToolInstallationRow[]> {
  return db.select().from(i).where(eq(i.personId, personId)).orderBy(asc(i.installedAt));
}

export async function installationByLabel(label: string): Promise<ToolInstallationRow | null> {
  const [row] = await db.select().from(i).where(eq(i.hostLabel, label)).limit(1);
  return row ?? null;
}

export async function installationById(id: string): Promise<ToolInstallationRow | null> {
  const [row] = await db.select().from(i).where(eq(i.id, id)).limit(1);
  return row ?? null;
}

async function touch(id: string, personId: string, set: Partial<typeof i.$inferInsert>): Promise<boolean> {
  const rows = await db
    .update(i)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(i.id, id), eq(i.personId, personId)))
    .returning({ id: i.id });
  return rows.length > 0;
}

export function setEnabled(id: string, personId: string, enabled: boolean): Promise<boolean> {
  return touch(id, personId, { enabled });
}

export function markRemoved(id: string, personId: string): Promise<boolean> {
  return touch(id, personId, { removedAt: new Date() });
}

export function markRestored(id: string, personId: string): Promise<boolean> {
  return touch(id, personId, { removedAt: null });
}
