// WHERE APPS INSTALLED ON THE DESKTOP LIVE (spec local 2026-11-26-apps-en-el-escritorio, §4.2): Postgres is the truth.
// One row per person and project; its release is an ordinary `toolReleases` row (immutable, keyed by its sha), and its
// host label is fixed for the row's whole life, so an update keeps the address the installed window already has.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export type DesktopAppRow = typeof schema.desktopApps.$inferSelect;

const a = schema.desktopApps;

/** Installs an app for a person, or moves their installation to the new release: the row's `id` and `hostLabel` stay,
 *  and a removed row comes back (`removedAt` is cleared). `installedAt` is the mark of THIS installation (spec local
 *  2026-11-27-notificaciones-del-escritorio, §5): an update of an active row keeps it, but a row that comes back from being
 *  removed is a new installation and gets a new one — the «yes» to a permission a device saved for the old one stops
 *  being worth anything. It is decided here, in the same statement that clears `removedAt`, so no reader can see one without
 *  the other. */
export async function upsertDesktopApp(input: {
  readonly personId: string;
  readonly projectId: string;
  readonly releaseSha: string;
  readonly name: string;
  readonly iconPath: string | null;
  readonly toolInstallationId: string | null;
  /** The installed version (`versionFingerprint`: files + production environment + keyed function secrets), under its first name. */
  readonly filesFingerprint: string;
  /** The private host's label for a new row's id; an update keeps the label it already has. */
  readonly hostLabelFor: (id: string) => string;
}): Promise<DesktopAppRow> {
  const id = randomUUID();
  const now = new Date();
  const [row] = await db
    .insert(a)
    .values({
      id,
      personId: input.personId,
      projectId: input.projectId,
      releaseSha: input.releaseSha,
      name: input.name,
      iconPath: input.iconPath,
      toolInstallationId: input.toolInstallationId,
      filesFingerprint: input.filesFingerprint,
      hostLabel: input.hostLabelFor(id),
      installedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [a.personId, a.projectId],
      set: {
        releaseSha: input.releaseSha,
        name: input.name,
        iconPath: input.iconPath,
        toolInstallationId: input.toolInstallationId,
        filesFingerprint: input.filesFingerprint,
        // The existing row's own `removedAt` (an ON CONFLICT SET reads the row as it was, whatever order the columns are in).
        installedAt: sql`CASE WHEN ${a.removedAt} IS NULL THEN ${a.installedAt} ELSE ${sql.param(now, a.installedAt)} END`,
        updatedAt: now,
        removedAt: null,
      },
    })
    .returning();
  if (!row) throw new Error("desktopApps: the upsert returned no row");
  return row;
}

export async function desktopAppById(id: string): Promise<DesktopAppRow | null> {
  const [row] = await db.select().from(a).where(eq(a.id, id)).limit(1);
  return row ?? null;
}

/** A person's installation of a project, removed or not, or null. */
export async function desktopAppOf(personId: string, projectId: string): Promise<DesktopAppRow | null> {
  const [row] = await db.select().from(a).where(and(eq(a.personId, personId), eq(a.projectId, projectId))).limit(1);
  return row ?? null;
}

/** The installation a private host label belongs to; a removed one has no host any more. */
export async function desktopAppByLabel(label: string): Promise<DesktopAppRow | null> {
  const [row] = await db.select().from(a).where(and(eq(a.hostLabel, label), isNull(a.removedAt))).limit(1);
  return row ?? null;
}

/** Whether anyone has the project installed on their desktop and not removed: publishing warns that the site and
 *  the desktop app share their production data (spec §5). */
export async function hasActiveDesktopApp(projectId: string): Promise<boolean> {
  const [row] = await db.select({ id: a.id }).from(a).where(and(eq(a.projectId, projectId), isNull(a.removedAt))).limit(1);
  return !!row;
}

/** Whether the project's production backend has someone on the desktop to answer (spec §5): `hasActiveDesktopApp`, but a
 *  row of a TOOL counts only while the tools are on (`tools`, `OPENLEN_TOOLS`) and the installation it points at is THIS
 *  person's, of THIS project, on and not removed — a tool that is not served (`desktopAppIsLive`) is no reason to call
 *  production. The join only matches an installation of the same project and person, and a missing one fails
 *  `enabled = true`. */
export async function hasLiveDesktopApp(projectId: string, o: { readonly tools: boolean }): Promise<boolean> {
  const t = schema.toolInstallations;
  const [row] = await db
    .select({ id: a.id })
    .from(a)
    .leftJoin(t, and(eq(t.id, a.toolInstallationId), eq(t.projectId, a.projectId), eq(t.personId, a.personId)))
    .where(
      and(
        eq(a.projectId, projectId),
        isNull(a.removedAt),
        o.tools ? or(isNull(a.toolInstallationId), and(eq(t.enabled, true), isNull(t.removedAt))) : isNull(a.toolInstallationId),
      ),
    )
    .limit(1);
  return !!row;
}

/** «Quitar del escritorio»: keeps the row, so the window can say the app is gone. Whether the row is the person's
 *  (another person's id changes nothing); removing twice keeps the first removal time. */
export async function markDesktopAppRemoved(id: string, personId: string): Promise<boolean> {
  const rows = await db
    .update(a)
    .set({ removedAt: sql`coalesce(${a.removedAt}, now())`, updatedAt: sql`now()` })
    .where(and(eq(a.id, id), eq(a.personId, personId)))
    .returning({ id: a.id });
  return rows.length > 0;
}
