// @vitest-environment node
//
// Installed tools and their releases against real Postgres (PGlite), with the tables exactly as
// `npm run tools:migrate` creates them (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.12).
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
const store = await import("./store");

const pg = () => base.pg as PGlite;
const label = (id: string) => `lienzo-${id.replace(/-/g, "").slice(0, 32).padEnd(32, "0")}`;

const install = (over: Partial<Parameters<typeof store.upsertInstallation>[0]> = {}) =>
  store.upsertInstallation({
    personId: "u1",
    projectId: "p1",
    releaseSha: "sha-1",
    placement: "rail",
    titles: { en: "Today's bookings", es: "Reservas de hoy" },
    descriptions: { en: "See and confirm today's bookings.", es: "Ver y confirmar las reservas de hoy." },
    iconPath: "/icon.svg",
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
  for (const statement of [...CREATE_TOOLS, ...CREATE_TOOLS]) await db.query(statement);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("tool installations", () => {
  it("one row per person and project; a reinstall keeps its id and host label", async () => {
    const first = await install();
    const again = await install({ releaseSha: "sha-2", placement: "project" });
    expect(again.id).toBe(first.id);
    expect(again.hostLabel).toBe(first.hostLabel);
    expect(again.releaseSha).toBe("sha-2");
    expect(again.placement).toBe("project");
    const { rows } = await pg().query(`SELECT count(*)::int AS n FROM "toolInstallations"`);
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("finds an installation by its host label", async () => {
    const row = await install();
    expect((await store.installationByLabel(row.hostLabel))?.id).toBe(row.id);
    expect(await store.installationByLabel("lienzo-ffffffffffffffffffffffffffffffff")).toBeNull();
  });

  it("removing keeps the row; restoring brings it back", async () => {
    const row = await install();
    expect(await store.markRemoved(row.id, "u1")).toBe(true);
    const [removed] = await store.listInstallations("u1");
    expect(removed?.removedAt).not.toBeNull();
    expect(await store.markRestored(row.id, "u1")).toBe(true);
    const [restored] = await store.listInstallations("u1");
    expect(restored?.removedAt).toBeNull();
  });

  it("a reinstall clears removedAt", async () => {
    const row = await install();
    await store.markRemoved(row.id, "u1");
    const again = await install({ releaseSha: "sha-3" });
    expect(again.removedAt).toBeNull();
  });

  it("a project has an active installation only while one is switched on and not removed (phase 4)", async () => {
    expect(await store.hasActiveInstallation("p1")).toBe(false);
    const row = await install();
    expect(await store.hasActiveInstallation("p1")).toBe(true);
    await store.setEnabled(row.id, "u1", false);
    expect(await store.hasActiveInstallation("p1")).toBe(false);
    await store.setEnabled(row.id, "u1", true);
    await store.markRemoved(row.id, "u1");
    expect(await store.hasActiveInstallation("p1")).toBe(false);
  });

  it("another person can't switch it off", async () => {
    const row = await install();
    expect(await store.setEnabled(row.id, "u2", false)).toBe(false);
    expect((await store.installationById(row.id))?.enabled).toBe(true);
    expect(await store.setEnabled(row.id, "u1", false)).toBe(true);
    expect((await store.installationById(row.id))?.enabled).toBe(false);
  });

  it("deleting the tool's project deletes its installation and releases", async () => {
    await install();
    await store.saveRelease("sha-1", "p1", { "/index.html": { content: "<html></html>", contentType: "text/html" } });
    await pg().query(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    expect(await store.listInstallations("u1")).toEqual([]);
    expect(await store.readRelease("sha-1")).toBeNull();
  });
});

describe("tool releases", () => {
  it("a release keeps its job files apart from what it serves (phase 3)", async () => {
    await store.saveRelease("sha-j", "p1", { "/index.html": { content: "<html></html>", contentType: "text/html" } }, { "/jobs/pdf.py": "print(1)" });
    expect(await store.readReleaseJobs("sha-j")).toEqual({ "/jobs/pdf.py": "print(1)" });
    expect(Object.keys((await store.readRelease("sha-j")) ?? {})).toEqual(["/index.html"]);
    await store.saveRelease("sha-k", "p1", { "/index.html": { content: "<html></html>", contentType: "text/html" } });
    expect(await store.readReleaseJobs("sha-k")).toEqual({});
    expect(await store.readReleaseJobs("missing")).toBeNull();
  });

  it("saving is idempotent on the sha", async () => {
    const files = { "/index.html": { content: "<html></html>", contentType: "text/html" } };
    await store.saveRelease("sha-1", "p1", files);
    await store.saveRelease("sha-1", "p1", files);
    expect(await store.readRelease("sha-1")).toEqual(files);
    expect(await store.readRelease("nope")).toBeNull();
  });
});
