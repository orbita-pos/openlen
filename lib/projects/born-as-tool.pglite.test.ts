// @vitest-environment node
//
// A BLANK PROJECT IS BORN AS A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.1, §4.13), against
// real Postgres (PGlite) with the columns the birth statement touches: only a blank project the person owns, and
// only on a paid plan.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown, plan: "pro" as string }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});
vi.mock("@/lib/limits", () => ({ getUserPlan: vi.fn(async () => base.plan) }));

const { bornAsTool } = await import("./born-as-tool");
const { toolSkeleton } = await import("@/lib/tools/skeleton");

const pg = () => base.pg as PGlite;

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY, "userId" text NOT NULL, "data" jsonb, "filesHash" text, "updatedAt" timestamptz);`);
  await db.query(`CREATE TABLE "projectFiles" ("projectId" text NOT NULL, "path" text NOT NULL, "content" text NOT NULL, "updatedAt" timestamptz, PRIMARY KEY ("projectId", "path"));`);
  await db.query(`CREATE TABLE "projectChatMessages" ("id" serial PRIMARY KEY, "projectId" text NOT NULL);`);
  await db.query(`INSERT INTO "projects" VALUES ('blank', 'u1', '{"html": ""}', null, now()), ('page', 'u1', '{"html": "<h1>Hola</h1>"}', null, now());`);
  base.pg = db;
  base.db = drizzle(db, { schema });
  base.plan = "pro";
});

const project = async (id: string) => {
  const { rows } = await pg().query<{ data: Record<string, unknown> }>(`SELECT "data" FROM "projects" WHERE "id" = $1`, [id]);
  const files = await pg().query<{ path: string }>(`SELECT "path" FROM "projectFiles" WHERE "projectId" = $1 ORDER BY "path"`, [id]);
  return { data: rows[0]!.data, paths: files.rows.map((r) => r.path) };
};

describe("bornAsTool", () => {
  it("a blank owned project gets the tool skeleton: data.app, data.tool and its files", async () => {
    expect(await bornAsTool({ projectId: "blank", userId: "u1", title: "Herramienta", locale: "es" })).toBe("born");
    const p = await project("blank");
    const s = toolSkeleton({ title: "Herramienta", locale: "es" });
    expect(p.data.app).toEqual(s.app);
    expect(p.data.tool).toEqual({ bornAt: expect.any(String) });
    expect(p.data.html).toBe(s.html);
    expect(p.paths).toEqual(Object.keys(s.files).sort());
  });

  it("a project with something in it is left alone", async () => {
    expect(await bornAsTool({ projectId: "page", userId: "u1", title: "Herramienta", locale: "es" })).toBe("not_blank");
    expect((await project("page")).data).toEqual({ html: "<h1>Hola</h1>" });
  });

  it("someone else's project is left alone", async () => {
    expect(await bornAsTool({ projectId: "blank", userId: "u2", title: "Herramienta", locale: "es" })).toBe("not_blank");
    expect((await project("blank")).paths).toEqual([]);
  });

  it("on the free plan nothing is written", async () => {
    base.plan = "free";
    expect(await bornAsTool({ projectId: "blank", userId: "u1", title: "Herramienta", locale: "es" })).toBe("plan_required");
    expect((await project("blank")).data).toEqual({ html: "" });
  });
});
