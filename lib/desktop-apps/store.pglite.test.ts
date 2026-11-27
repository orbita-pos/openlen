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
