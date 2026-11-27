// @vitest-environment node
//
// Apps installed on the desktop against real Postgres (PGlite), with the tables exactly as
// `npm run desktop-apps:migrate` creates them (spec local 2026-11-26-apps-en-el-escritorio, §4.2).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_TOOLS } = await import("@/scripts/tools-migrate-sql");
const { CREATE_DESKTOP_APPS } = await import("@/scripts/desktop-apps-migrate-sql");
const store = await import("./store");

const pg = () => base.pg as PGlite;
const label = (id: string) => `lienzo-${id.replace(/-/g, "").slice(0, 32).padEnd(32, "0")}`;

const install = (over: Partial<Parameters<typeof store.upsertDesktopApp>[0]> = {}) =>
  store.upsertDesktopApp({
    personId: "u1",
    projectId: "p1",
    releaseSha: "sha-1",
    name: "Bookings",
    iconPath: null,
    toolInstallationId: null,
    filesFingerprint: "fp-1",
    hostLabelFor: label,
    ...over,
  });

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await db.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await db.query(`INSERT INTO "projects" VALUES ('p1'), ('p2');`);
  // Twice: the migration is idempotent.
  for (const statement of [...CREATE_TOOLS, ...CREATE_DESKTOP_APPS, ...CREATE_TOOLS, ...CREATE_DESKTOP_APPS]) await db.query(statement);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("desktop apps", () => {
  it("upsert twice keeps id and hostLabel, moves releaseSha and fingerprint", async () => {
    const first = await install();
    const again = await install({ releaseSha: "sha-2", filesFingerprint: "fp-2", name: "Bookings 2", iconPath: "/icon.svg" });
    expect(again.id).toBe(first.id);
    expect(again.hostLabel).toBe(first.hostLabel);
    expect(again.releaseSha).toBe("sha-2");
    expect(again.filesFingerprint).toBe("fp-2");
    expect(again.name).toBe("Bookings 2");
    expect(again.iconPath).toBe("/icon.svg");
    const { rows } = await pg().query(`SELECT count(*)::int AS n FROM "desktopApps"`);
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("upsert after remove clears removedAt", async () => {
    const row = await install();
    expect(await store.markDesktopAppRemoved(row.id, "u1")).toBe(true);
    expect((await store.desktopAppById(row.id))?.removedAt).not.toBeNull();
    const again = await install({ releaseSha: "sha-3" });
    expect(again.id).toBe(row.id);
    expect(again.removedAt).toBeNull();
    expect((await store.desktopAppById(row.id))?.removedAt).toBeNull();
  });

  it("byLabel ignores removed rows", async () => {
    const row = await install();
    expect((await store.desktopAppByLabel(row.hostLabel))?.id).toBe(row.id);
    expect(await store.desktopAppByLabel("lienzo-ffffffffffffffffffffffffffffffff")).toBeNull();
    await store.markDesktopAppRemoved(row.id, "u1");
    expect(await store.desktopAppByLabel(row.hostLabel)).toBeNull();
  });

  it("hasActiveDesktopApp is false once removed", async () => {
    expect(await store.hasActiveDesktopApp("p1")).toBe(false);
    const row = await install();
    expect(await store.hasActiveDesktopApp("p1")).toBe(true);
    expect(await store.hasActiveDesktopApp("p2")).toBe(false);
    await store.markDesktopAppRemoved(row.id, "u1");
    expect(await store.hasActiveDesktopApp("p1")).toBe(false);
  });

  // The production backend answers a desktop app only while it is served (spec §5): a tool's row needs its installation on.
  const toolInstallation = (id: string, over: { personId?: string; enabled?: boolean; removedAt?: string | null } = {}) =>
    pg().query(
      `INSERT INTO "toolInstallations" ("id", "personId", "projectId", "releaseSha", "placement", "iconPath", "hostLabel", "enabled", "removedAt")
       VALUES ($1, $2, 'p1', 'sha-1', 'rail', '/icon.svg', $3, $4, $5)`,
      [id, over.personId ?? "u1", `lienzo-tool-${id}`, over.enabled ?? true, over.removedAt ?? null],
    );

  it("hasLiveDesktopApp: an ordinary app counts until it is removed", async () => {
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
    const row = await install();
    expect(await store.hasLiveDesktopApp("p1")).toBe(true);
    expect(await store.hasLiveDesktopApp("p2")).toBe(false);
    await store.markDesktopAppRemoved(row.id, "u1");
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
  });

  it("hasLiveDesktopApp: a tool's row counts only while its installation exists, is on and is not removed", async () => {
    const row = await install({ toolInstallationId: "ti-1" });
    // the installation is not there at all
    expect(await store.hasActiveDesktopApp("p1")).toBe(true);
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
    await toolInstallation("ti-1");
    expect(await store.hasLiveDesktopApp("p1")).toBe(true);
    await pg().query(`UPDATE "toolInstallations" SET "enabled" = false WHERE "id" = 'ti-1'`);
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
    await pg().query(`UPDATE "toolInstallations" SET "enabled" = true, "removedAt" = now() WHERE "id" = 'ti-1'`);
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
    await pg().query(`UPDATE "toolInstallations" SET "removedAt" = NULL WHERE "id" = 'ti-1'`);
    expect(await store.hasLiveDesktopApp("p1")).toBe(true);
    await store.markDesktopAppRemoved(row.id, "u1");
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
  });

  it("hasLiveDesktopApp: one person's switched-off tool does not hide another person's live app", async () => {
    await install({ toolInstallationId: "ti-1" });
    await toolInstallation("ti-1", { enabled: false });
    expect(await store.hasLiveDesktopApp("p1")).toBe(false);
    await install({ personId: "u2" });
    expect(await store.hasLiveDesktopApp("p1")).toBe(true);
  });

  it("markDesktopAppRemoved by another person returns false and changes nothing", async () => {
    const row = await install();
    expect(await store.markDesktopAppRemoved(row.id, "u2")).toBe(false);
    expect((await store.desktopAppById(row.id))?.removedAt).toBeNull();
    expect(await store.hasActiveDesktopApp("p1")).toBe(true);
  });

  it("deleting the project deletes the row", async () => {
    const row = await install();
    await pg().query(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    expect(await store.desktopAppById(row.id)).toBeNull();
    const { rows } = await pg().query(`SELECT count(*)::int AS n FROM "desktopApps"`);
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it("finds a person's app by project, and one person's app is not another's", async () => {
    const row = await install();
    expect((await store.desktopAppOf("u1", "p1"))?.id).toBe(row.id);
    expect(await store.desktopAppOf("u2", "p1")).toBeNull();
    expect(await store.desktopAppOf("u1", "p2")).toBeNull();
    const other = await install({ personId: "u2" });
    expect(other.id).not.toBe(row.id);
    expect(other.hostLabel).not.toBe(row.hostLabel);
  });

  it("keeps the tool installation it was installed from, or null", async () => {
    const plain = await install();
    expect(plain.toolInstallationId).toBeNull();
    const fromTool = await install({ projectId: "p2", toolInstallationId: "ti-1" });
    expect(fromTool.toolInstallationId).toBe("ti-1");
  });
});
