// @vitest-environment node
//
// A BLANK PROJECT IS BORN AS A THEME (spec local 2026-11-27-temas-del-workspace, §4.1), against real Postgres (PGlite)
// with the columns the birth statement touches: only a blank project the person owns — and on any plan, because themes
// are open to every plan. A theme is no app: it gets `data.theme` and a folder with no /src.
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
const plan = vi.hoisted(() => vi.fn(async () => "free"));
vi.mock("@/lib/limits", () => ({ getUserPlan: plan }));

const { bornAsTheme } = await import("./born-as-theme");
const { themeSkeleton } = await import("@/lib/themes/skeleton");

const pg = () => base.pg as PGlite;

beforeEach(async () => {
  const db = new PGlite();
  await db.query(
    `CREATE TABLE "projects" ("id" text PRIMARY KEY, "userId" text NOT NULL, "data" jsonb, "filesHash" text, "userBrief" text, "updatedAt" timestamptz);`,
  );
  await db.query(`CREATE TABLE "projectFiles" ("projectId" text NOT NULL, "path" text NOT NULL, "content" text NOT NULL, "updatedAt" timestamptz, PRIMARY KEY ("projectId", "path"));`);
  await db.query(`CREATE TABLE "projectChatMessages" ("id" serial PRIMARY KEY, "projectId" text NOT NULL);`);
  await db.query(
    `INSERT INTO "projects" VALUES ('blank', 'u1', '{"html": ""}', null, null, now()), ('page', 'u1', '{"html": "<h1>Hola</h1>"}', null, null, now()), ('noted', 'u1', '{"html": ""}', null, 'Mis notas', now());`,
  );
  base.pg = db;
  base.db = drizzle(db, { schema });
  plan.mockClear();
});

const project = async (id: string) => {
  const { rows } = await pg().query<{ data: Record<string, unknown>; userBrief: string | null }>(`SELECT "data", "userBrief" FROM "projects" WHERE "id" = $1`, [id]);
  const files = await pg().query<{ path: string }>(`SELECT "path" FROM "projectFiles" WHERE "projectId" = $1 ORDER BY "path"`, [id]);
  return { data: rows[0]!.data, userBrief: rows[0]!.userBrief, paths: files.rows.map((r) => r.path) };
};

describe("bornAsTheme", () => {
  it("🔴 a blank owned project gets data.theme and the theme's folder — and no data.app: a theme is no app", async () => {
    expect(await bornAsTheme({ projectId: "blank", userId: "u1", title: "Theme", locale: "es" })).toBe("born");
    const p = await project("blank");
    const s = themeSkeleton({ title: "Theme", locale: "es" });
    expect(p.data.theme).toEqual({ bornAt: expect.any(String) });
    expect(p.data.app).toBeUndefined();
    expect(p.data.tool).toBeUndefined();
    expect(p.data.game).toBeUndefined();
    expect(p.data.html).toBe(s.html);
    expect(p.paths.some((x) => x.startsWith("/src"))).toBe(false);
  });

  it("🔴 /LEN.md is the project's memory (`projects.userBrief`), not a file of its folder", async () => {
    await bornAsTheme({ projectId: "blank", userId: "u1", title: "Theme", locale: "es" });
    const p = await project("blank");
    const s = themeSkeleton({ title: "Theme", locale: "es" });
    expect(p.userBrief).toBe(s.files["/LEN.md"]);
    expect(p.paths).toEqual(Object.keys(s.files).filter((x) => x !== "/LEN.md").sort());
    expect(p.paths).toContain("/package.json");
    expect(p.paths).toContain("/themes/preview.html");
  });

  it("a memory the person already wrote is never overwritten", async () => {
    expect(await bornAsTheme({ projectId: "noted", userId: "u1", title: "Theme", locale: "en" })).toBe("born");
    expect((await project("noted")).userBrief).toBe("Mis notas");
  });

  it("a project with something in it is left alone", async () => {
    expect(await bornAsTheme({ projectId: "page", userId: "u1", title: "Theme", locale: "es" })).toBe("not_blank");
    const p = await project("page");
    expect(p.data).toEqual({ html: "<h1>Hola</h1>" });
    expect(p.userBrief).toBeNull();
    expect(p.paths).toEqual([]);
  });

  it("someone else's project is left alone", async () => {
    expect(await bornAsTheme({ projectId: "blank", userId: "u2", title: "Theme", locale: "es" })).toBe("not_blank");
    const p = await project("blank");
    expect(p.paths).toEqual([]);
    expect(p.userBrief).toBeNull();
  });

  it("🔴 on the free plan it is born too: themes are open to every plan", async () => {
    expect(await bornAsTheme({ projectId: "blank", userId: "u1", title: "Theme", locale: "es" })).toBe("born");
    expect(plan).not.toHaveBeenCalled();
  });

  it("is born once: a second birth finds the project no longer blank", async () => {
    expect(await bornAsTheme({ projectId: "blank", userId: "u1", title: "Theme", locale: "es" })).toBe("born");
    expect(await bornAsTheme({ projectId: "blank", userId: "u1", title: "Theme", locale: "es" })).toBe("not_blank");
  });
});
