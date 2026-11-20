// @vitest-environment node
//
// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2): one hidden project per person, the home of their
// agents, as Claude Code's agents work in the person's folder. Against real Postgres (PGlite), with the index
// `npm run assistants:migrate` creates.
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

const { CREATE_ASSISTANTS, CREATE_SPACE } = await import("@/scripts/assistants-migrate-sql");
const { ensureSpace, spaceIdOf } = await import("./store");
const { isSpaceData } = await import("./types");
const { projectsTableSql } = await import("./test-helpers");

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(projectsTableSql());
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  for (const statement of [...CREATE_ASSISTANTS, ...CREATE_SPACE]) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

const spacesOf = async (userId: string) =>
  (await pg.query<{ n: number }>(`select count(*)::int as n from "projects" where "userId" = $1 and ("data"->'space') is not null`, [userId])).rows[0]!.n;

describe("ensureSpace", () => {
  it("creates one hidden project the first time and returns the same id after", async () => {
    const first = await ensureSpace("u1");
    const second = await ensureSpace("u1");
    expect(second).toBe(first);
    const row = (await pg.query<{ data: { html: string; space: { bornAt: string } } }>(`select "data" from "projects" where "id" = $1`, [first])).rows[0]!;
    expect(row.data.html).toBe("");
    expect(new Date(row.data.space.bornAt).toISOString()).toBe(row.data.space.bornAt);
    expect(await spacesOf("u1")).toBe(1);
  });

  it("called twice at once still makes one space", async () => {
    const [a, b] = await Promise.all([ensureSpace("u1"), ensureSpace("u1")]);
    expect(a).toBe(b);
    expect(await spacesOf("u1")).toBe(1);
  });

  it("each person has their own", async () => {
    expect(await ensureSpace("u1")).not.toBe(await ensureSpace("u2"));
  });
});

describe("spaceIdOf", () => {
  it("is null before and the id after", async () => {
    expect(await spaceIdOf("u1")).toBeNull();
    const id = await ensureSpace("u1");
    expect(await spaceIdOf("u1")).toBe(id);
  });
});

describe("isSpaceData", () => {
  it("tells a space from everything else", () => {
    expect(isSpaceData({ space: { bornAt: "2026-11-19T00:00:00.000Z" } })).toBe(true);
    expect(isSpaceData({})).toBe(false);
    expect(isSpaceData(null)).toBe(false);
    expect(isSpaceData(undefined)).toBe(false);
    expect(isSpaceData({ space: null })).toBe(false);
  });
});
