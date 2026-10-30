// @vitest-environment node
//
// Len Watch's settings and incidents against real Postgres (PGlite), with the tables exactly as
// `scripts/len-watch-migrate.ts` creates them.
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

const { CREATE_LEN_WATCH } = await import("@/scripts/len-watch-migrate-sql");
const store = await import("./store");

const SAMPLE = { message: "boom", file: "/assets/i.js", line: 1, col: 2, page: null };

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await pg.query(`INSERT INTO "projects" VALUES ('p1'), ('p2');`);
  for (const statement of CREATE_LEN_WATCH) await pg.query(statement);
  base.pg = pg;
  base.db = drizzle(pg, { schema });
});

describe("settings", () => {
  it("defaults to watching, with fixing and publishing off", async () => {
    expect(await store.getSettings("p1")).toEqual({ autoFix: false, autoPublish: false, muted: false, locale: null });
  });

  it("never turns publishing on without fixing", async () => {
    const s = await store.saveSettings("p1", { autoPublish: true });
    expect(s.autoPublish).toBe(false);
    expect(await store.getSettings("p1")).toMatchObject({ autoFix: false, autoPublish: false });
  });

  it("turning fixing off turns publishing off too", async () => {
    await store.saveSettings("p1", { autoFix: true, autoPublish: true });
    expect(await store.getSettings("p1")).toMatchObject({ autoFix: true, autoPublish: true });
    const s = await store.saveSettings("p1", { autoFix: false });
    expect(s).toMatchObject({ autoFix: false, autoPublish: false });
  });

  it("keeps what the patch doesn't name", async () => {
    await store.saveSettings("p1", { muted: true, locale: "es" });
    expect(await store.saveSettings("p1", { autoFix: true })).toEqual({ autoFix: true, autoPublish: false, muted: true, locale: "es" });
  });
});

describe("incidents", () => {
  it("one active incident per project", async () => {
    const first = await store.openIncident("p1", SAMPLE);
    expect(first).not.toBeNull();
    expect(await store.openIncident("p1", SAMPLE)).toBeNull();
    expect((await store.activeIncident("p1"))?.id).toBe(first!.id);
    expect(await store.openIncident("p2", SAMPLE)).not.toBeNull();
  });

  it("a failed fix is still active", async () => {
    const i = await store.openIncident("p1", SAMPLE);
    await store.updateIncident(i!.id, { status: "fix_failed" });
    expect(await store.openIncident("p1", SAMPLE)).toBeNull();
    expect((await store.activeIncident("p1"))?.status).toBe("fix_failed");
  });

  it("a resolved incident lets a new one open", async () => {
    const i = await store.openIncident("p1", SAMPLE);
    await store.resolveIncident(i!.id, "fixed");
    expect(await store.activeIncident("p1")).toBeNull();
    const resolved = await store.incidentById(i!.id);
    expect(resolved).toMatchObject({ status: "resolved", resolution: "fixed" });
    expect(resolved?.resolvedAt).toBeInstanceOf(Date);
    expect(await store.openIncident("p1", SAMPLE)).not.toBeNull();
  });

  it("stores the sample and counts reports", async () => {
    const i = await store.openIncident("p1", SAMPLE);
    expect(i).toMatchObject({ status: "open", reports: 1, sample: SAMPLE, shipsUnpublished: false, summary: null });
    await store.countReport(i!.id);
    await store.countReport(i!.id);
    expect((await store.incidentById(i!.id))?.reports).toBe(3);
  });

  it("prunes resolved incidents older than 90 days when it opens one", async () => {
    const old = await store.openIncident("p1", SAMPLE);
    await store.resolveIncident(old!.id, "recovered");
    const pg = base.pg as PGlite;
    await pg.query(`UPDATE "lenWatchIncidents" SET "resolvedAt" = now() - interval '91 days' WHERE "id" = $1`, [old!.id]);
    await store.openIncident("p2", SAMPLE);
    expect(await store.incidentById(old!.id)).toBeNull();
  });
});
