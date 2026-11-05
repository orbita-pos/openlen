// WHERE INSTALLED TOOLS LIVE (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.12): Postgres is the
// truth. A release is immutable and keyed by its sha; an installation is one row per person and tool project,
// whose host label is fixed for its whole life, so a reinstall keeps the address the workspace already framed.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { ReleaseMcp } from "./mcp/discover";
import type { ToolPlacement, ToolReleaseFile } from "./types";

export type ToolInstallationRow = typeof schema.toolInstallations.$inferSelect;

const i = schema.toolInstallations;
const r = schema.toolReleases;

export async function saveRelease(
  sha: string,
  projectId: string,
  files: Record<string, ToolReleaseFile>,
  jobFiles: Record<string, string> = {},
  mcp: ReleaseMcp | null = null,
): Promise<void> {
  // A version's files never change; its operations may be found later (installed again once the functions are on).
  const insert = db.insert(r).values({ sha, projectId, files, jobFiles, mcp: mcp as never });
  await (mcp ? insert.onConflictDoUpdate({ target: r.sha, set: { mcp: mcp as never } }) : insert.onConflictDoNothing({ target: r.sha }));
}

/** A version's MCP server and operations (phase 4), or null. */
export async function readReleaseMcp(sha: string): Promise<ReleaseMcp | null> {
  const [row] = await db.select({ mcp: r.mcp }).from(r).where(eq(r.sha, sha)).limit(1);
  return (row?.mcp as ReleaseMcp | null | undefined) ?? null;
}

/** A version's job files (phase 3, §4.6): what its jobs run; `{}` for a version without jobs, null for none. */
export async function readReleaseJobs(sha: string): Promise<Record<string, string> | null> {
  const [row] = await db.select({ jobFiles: r.jobFiles }).from(r).where(eq(r.sha, sha)).limit(1);
  return row ? (row.jobFiles ?? {}) : null;
}

export async function readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null> {
  const [row] = await db.select({ files: r.files }).from(r).where(eq(r.sha, sha)).limit(1);
  return row?.files ?? null;
}

/** A person's installation of a tool project, or null. */
export async function installationOf(personId: string, projectId: string): Promise<ToolInstallationRow | null> {
  const [row] = await db.select().from(i).where(and(eq(i.personId, personId), eq(i.projectId, projectId))).limit(1);
  return row ?? null;
}

/** The person's email: their tool's backend signs them in by it (Len's eyes run the bridge in Node). */
export async function personEmail(personId: string): Promise<string> {
  const [row] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, personId)).limit(1);
  return row?.email ?? "";
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

/** Who frames a tool on a label: the workspace (`hostLabel`) or the phone app (`phoneHostLabel`, phase 5). */
export type ToolServedTo = "workspace" | "phone";

export async function installationByLabel(label: string): Promise<(ToolInstallationRow & { servedTo: ToolServedTo }) | null> {
  const [row] = await db
    .select()
    .from(i)
    .where(or(eq(i.hostLabel, label), eq(i.phoneHostLabel, label)))
    .limit(1);
  return row ? { ...row, servedTo: row.hostLabel === label ? "workspace" : "phone" } : null;
}

/** Keeps the phone's label on the row (phase 5): it is an HMAC of the id, so writing it again changes nothing. */
export async function setPhoneHostLabel(installationId: string, label: string): Promise<void> {
  await db.update(i).set({ phoneHostLabel: label }).where(eq(i.id, installationId));
}

/** Whether the tool project has an installation switched on and not removed: its production functions answer (phase 4). */
export async function hasActiveInstallation(projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: i.id })
    .from(i)
    .where(and(eq(i.projectId, projectId), eq(i.enabled, true), isNull(i.removedAt)))
    .limit(1);
  return !!row;
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
