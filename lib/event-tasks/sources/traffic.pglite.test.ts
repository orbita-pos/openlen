// @vitest-environment node
//
// The `traffic` source (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.4): each complete local day of the
// published page's visits against the same weekday a week before, in the task's zone — the day cut as the Results view
// cuts it (lib/resultados/visitas.ts). Against real Postgres (PGlite), with `pageEvents` as the beacon writes it.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return base.db;
  },
}));

const { trafficSource } = await import("./traffic");

let pg: PGlite;
const ctx = (iso: string, timeZone = "UTC") => ({ timeZone, now: new Date(iso), ownerId: "owner" });

/** `n` views at a UTC moment, each from its own visitor unless `ua` says otherwise. */
async function views(n: number, utc: string, o: { page?: string | null; ua?: string; referrer?: string; project?: string } = {}) {
  for (let i = 0; i < n; i++) {
    await pg.query(`INSERT INTO "pageEvents" (id, "projectId", type, page, "uaHash", referrer, ts) VALUES ($1, $2, 'view', $3, $4, $5, $6)`, [
      `${utc}-${o.page ?? "home"}-${o.ua ?? ""}-${i}-${Math.random()}`,
      o.project ?? "p1",
      o.page ?? null,
      o.ua ?? `ua-${i}`,
      o.referrer ?? null,
      utc,
    ]);
  }
}

async function started(params: Record<string, unknown>, at: string, zone = "UTC") {
  const v = await trafficSource.validate("p1", params, ctx(at, zone));
  if (!v.ok) throw new Error(v.reason);
  return v.initialState;
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "projects" ("id" text PRIMARY KEY);
    INSERT INTO "projects" VALUES ('p1'), ('p2');
    CREATE TABLE "pageEvents" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "type" text NOT NULL, "href" text, "linkLabel" text, "referrer" text, "country" text, "device" text, "browser" text, "uaHash" text, "page" text, "cid" text, "source" jsonb, "ts" timestamp NOT NULL DEFAULT now());`);
  base.db = drizzle(pg, { schema });
});

describe("traffic", () => {
  it("a day that falls more than the threshold against the same weekday a week before is one change", async () => {
    const state = await started({}, "2026-11-03T12:00:00Z");
    await views(40, "2026-10-27 10:00:00");
    await views(20, "2026-11-03 10:00:00");
    const o = await trafficSource.observe("p1", {}, state, ctx("2026-11-04T01:00:00Z"));
    expect(o.changes).toHaveLength(1);
    expect(o.changes[0]).toMatchObject({
      subject: "traffic",
      link: "2026-11-03",
      summary: "views 2026-11-03: 20 (-50% vs 2026-10-27: 40)",
      detail: { day: "2026-11-03", compared_to: "2026-10-27", metric: "views", page: "all", current: 20, previous: 40, change_percent: -50, direction: "down" },
    });
    expect(o.state).toEqual({ lastDay: "2026-11-03" });
    expect((await trafficSource.observe("p1", {}, o.state, ctx("2026-11-04T20:00:00Z"))).changes).toEqual([]);
  });

  it("below min_views nothing fires, however large the percentage", async () => {
    const state = await started({}, "2026-11-03T12:00:00Z");
    await views(15, "2026-10-27 10:00:00");
    await views(5, "2026-11-03 10:00:00");
    const o = await trafficSource.observe("p1", {}, state, ctx("2026-11-04T01:00:00Z"));
    expect(o.changes).toEqual([]);
    expect(o.state).toEqual({ lastDay: "2026-11-03" });
  });

  it("each complete local day is compared once, in the task's time zone", async () => {
    // 23:30 in Mexico City on the 3rd is 05:30 UTC on the 4th: it counts for the 3rd there.
    const state = await started({}, "2026-11-03T18:00:00Z", "America/Mexico_City");
    await views(40, "2026-10-27 18:00:00");
    await views(20, "2026-11-04 05:30:00");
    const o = await trafficSource.observe("p1", {}, state, ctx("2026-11-04T12:00:00Z", "America/Mexico_City"));
    expect(o.changes.map((c) => c.detail)).toMatchObject([{ day: "2026-11-03", current: 20, previous: 40 }]);
    expect((await trafficSource.observe("p1", {}, o.state, ctx("2026-11-04T23:00:00Z", "America/Mexico_City"))).changes).toEqual([]);
  });

  it("days missed while the server was down: only the latest is compared", async () => {
    const state = await started({}, "2026-11-01T12:00:00Z");
    await views(40, "2026-10-26 10:00:00");
    await views(10, "2026-11-02 10:00:00");
    await views(50, "2026-10-28 10:00:00");
    await views(10, "2026-11-04 10:00:00");
    const o = await trafficSource.observe("p1", {}, state, ctx("2026-11-05T12:00:00Z"));
    expect(o.changes.map((c) => c.detail.day)).toEqual(["2026-11-04"]);
    expect(o.state).toEqual({ lastDay: "2026-11-04" });
  });

  it('page narrows to one page; omitted, the whole site; "/" is the home page', async () => {
    const state = await started({}, "2026-11-03T12:00:00Z");
    await views(40, "2026-10-27 10:00:00", { page: "menu" });
    await views(40, "2026-10-27 10:00:00");
    await views(10, "2026-11-03 10:00:00", { page: "menu" });
    await views(40, "2026-11-03 10:00:00");
    const at = ctx("2026-11-04T01:00:00Z");
    expect((await trafficSource.observe("p1", { page: "menu" }, state, at)).changes.map((c) => c.detail)).toMatchObject([{ page: "menu", current: 10, previous: 40 }]);
    expect((await trafficSource.observe("p1", { page: "/" }, state, at)).changes).toEqual([]);
    expect((await trafficSource.observe("p1", {}, state, at)).changes.map((c) => c.detail)).toMatchObject([{ page: "all", current: 50, previous: 80 }]);
  });

  it("direction up ignores a fall", async () => {
    const state = await started({ direction: "up" }, "2026-11-03T12:00:00Z");
    await views(40, "2026-10-27 10:00:00");
    await views(20, "2026-11-03 10:00:00");
    expect((await trafficSource.observe("p1", { direction: "up" }, state, ctx("2026-11-04T01:00:00Z"))).changes).toEqual([]);
  });

  it("visitors counts people, not views", async () => {
    const state = await started({ metric: "visitors" }, "2026-11-03T12:00:00Z");
    await views(40, "2026-10-27 10:00:00");
    await views(30, "2026-11-03 10:00:00", { ua: "the-same-person" });
    const o = await trafficSource.observe("p1", { metric: "visitors" }, state, ctx("2026-11-04T01:00:00Z"));
    expect(o.changes.map((c) => c.detail)).toMatchObject([{ metric: "visitors", current: 1, previous: 40, direction: "down" }]);
  });

  it("read gives the day's top pages and where they came from, and the fortnight before; another project's visits are not counted", async () => {
    await views(3, "2026-11-03 10:00:00", { page: "menu", referrer: "https://www.google.com/search?q=x" });
    await views(2, "2026-11-03 11:00:00");
    await views(4, "2026-11-01 10:00:00");
    await views(9, "2026-11-03 10:00:00", { project: "p2" });
    const state = await started({}, "2026-11-03T12:00:00Z");
    const read = (await trafficSource.read("p1", {}, { keys: ["2026-11-03"], state, ctx: ctx("2026-11-04T01:00:00Z") })) as {
      items: { day: string; views: number; visitors: number; pages: { page: string; views: number }[]; from: { from: string; views: number }[] }[];
      previous: { day: string; views: number }[];
    };
    expect(read.items).toEqual([
      { day: "2026-11-03", views: 5, visitors: 3, pages: [{ page: "/menu", views: 3 }, { page: "/", views: 2 }], from: [{ from: "www.google.com", views: 3 }, { from: "direct", views: 2 }] },
    ]);
    expect(read.previous).toEqual([{ day: "2026-11-01", views: 4, visitors: 4 }]);
    await expect(trafficSource.read("p1", {}, { keys: [], state, match: [{ field: "page", value: "x" }], ctx: ctx("2026-11-04T01:00:00Z") })).rejects.toMatchObject({ reason: "column_missing" });
  });
});
