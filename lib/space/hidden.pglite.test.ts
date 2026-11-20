// @vitest-environment node
//
// THE SPACE NEVER SHOWS (spec local 2026-11-19-agentes-para-todos, §6.2): not in the projects list (and so not in the
// top bar, the phone, MCP or analytics, which read it), not handed out as «the blank project», not turned into an app
// by a first message, and not on the person's profile. Against real Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

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

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { ensureSpace } = await import("./store");
const { tableSql } = await import("./test-helpers");
const { listProjects, findOrCreateBlankProject } = await import("@/lib/projects");
const { nacerComoApp } = await import("@/lib/projects/nacer-como-app");
const { listProfileProjects } = await import("@/lib/profile/store");

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  for (const t of [schema.projects, schema.projectChatMessages, schema.projectMembers, schema.projectEnvVars, schema.projectFiles]) await pg.query(tableSql(t));
  await pg.query(`insert into "users" values ('u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

async function aPage(id: string) {
  await pg.query(`insert into "projects" ("id", "userId", "title", "brief", "status", "tags", "data", "updatedAt") values ($1, 'u1', 'Pastelería', '', 'draft', '{}', '{"html":"<h1>Hola</h1>"}', now())`, [id]);
}

async function talkedTo(projectId: string) {
  await pg.query(`insert into "projectChatMessages" ("id", "projectId", "conversation") values ($1, $2, 'assistant:a1')`, [`m-${projectId}`, projectId]);
}

describe("the space is hidden", () => {
  it("listProjects never returns the space", async () => {
    await aPage("page");
    const space = await ensureSpace("u1");
    await talkedTo(space);
    expect((await listProjects("u1")).map((p) => p.id)).toEqual(["page"]);
  });

  it("findOrCreateBlankProject never hands out the space", async () => {
    const space = await ensureSpace("u1");
    const blank = await findOrCreateBlankProject("u1");
    expect(blank).not.toBe(space);
  });

  it("bornWithSkeleton leaves the space untouched", async () => {
    const space = await ensureSpace("u1");
    expect(await nacerComoApp({ projectId: space, userId: "u1", titulo: "App" })).toBe(false);
    const row = (await pg.query<{ data: { app?: unknown } }>(`select "data" from "projects" where "id" = $1`, [space])).rows[0]!;
    expect(row.data.app).toBeUndefined();
  });

  it("the profile never lists the space", async () => {
    await aPage("page");
    const space = await ensureSpace("u1");
    await talkedTo(space);
    expect((await listProfileProjects("u1", "u1")).projects.map((p) => p.id)).toEqual(["page"]);
  });
});
