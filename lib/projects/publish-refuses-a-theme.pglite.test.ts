// @vitest-environment node
//
// A THEME IS INSTALLED, NOT PUBLISHED (spec local 2026-11-27-temas-del-workspace, §4.5; ruling R22), at the bottom door:
// `publishProject` refuses a theme project before it claims an address or writes anything — whoever calls it (the top
// bar's route, MCP, Len Watch, Len with themes off) — and the gates answer 409 `project_is_theme`.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { publishProject } = await import("@/lib/projects");
const { ProjectIsThemeError } = await import("@/lib/themes/errors");
const { publishErrorResult } = await import("@/lib/projects/publish-through-gates");

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY, "userId" text NOT NULL, "title" text, "data" jsonb, "subdomain" text, "logoUrl" text);`);
  await db.query(`INSERT INTO "projects" VALUES ('th1', 'u1', 'Pond', '{"html": "<!doctype html><p>preview</p>", "theme": {"bornAt": "2026-11-27T00:00:00Z"}}', null, null);`);
  base.db = drizzle(db, { schema });
});

describe("publishProject", () => {
  it("refuses a theme project, and nothing is claimed", async () => {
    await expect(publishProject({ projectId: "th1", userId: "u1", subdomain: "pond" })).rejects.toBeInstanceOf(ProjectIsThemeError);
    const [row] = await (base.db as ReturnType<typeof drizzle>).select({ subdomain: schema.projects.subdomain }).from(schema.projects);
    expect(row?.subdomain).toBeNull();
  });

  it("the gates answer it as 409 project_is_theme", () => {
    expect(publishErrorResult(new ProjectIsThemeError())).toEqual({ status: 409, body: { error: "project_is_theme" } });
  });
});
