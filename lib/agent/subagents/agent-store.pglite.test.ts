// @vitest-environment node
//
// The subagent types a project and a person keep (spec local 2026-11-01-subagentes-de-len, §6), against real
// Postgres (PGlite), with the table as `npm run subagents:migrate` creates it.
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

const { ALTER_AGENT_REQUEST_STEPS, ALTER_SUBAGENT_RUNS, CREATE_LEN_AGENTS, CREATE_SUBAGENTS } = await import("@/scripts/subagents-migrate-sql");
const { deleteAgent, listAgents, upsertAgent } = await import("./agent-store");

const TYPE = "---\nname: reviewer\ndescription: Reviews copy\n---\n\nReview the copy.\n";
let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  for (const statement of CREATE_LEN_AGENTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

describe("lenAgents store", () => {
  it("a type is stored, listed by name and replaced in place", async () => {
    expect(await upsertAgent("project", "p1", "reviewer", TYPE, "u1")).toEqual({ before: null });
    await upsertAgent("project", "p1", "a-first", TYPE.replace("reviewer", "a-first"), "u1");
    expect((await listAgents("project", "p1")).map((a) => a.name)).toEqual(["a-first", "reviewer"]);
    const changed = TYPE.replace("Review the copy.", "Review it twice.");
    expect(await upsertAgent("project", "p1", "reviewer", changed, "u2")).toEqual({ before: TYPE });
    expect((await listAgents("project", "p1")).find((a) => a.name === "reviewer")!.text).toBe(changed);
    const rows = await pg.query<{ n: number }>(`select count(*)::int as n from "lenAgents"`);
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("deleting is soft and writing the same name revives the row", async () => {
    await upsertAgent("project", "p1", "reviewer", TYPE, "u1");
    expect(await deleteAgent("project", "p1", "reviewer")).toEqual({ before: TYPE });
    expect(await listAgents("project", "p1")).toEqual([]);
    expect(await deleteAgent("project", "p1", "reviewer")).toEqual({ before: null });
    expect(await upsertAgent("project", "p1", "reviewer", TYPE, "u1")).toEqual({ before: null });
    expect((await listAgents("project", "p1")).map((a) => a.name)).toEqual(["reviewer"]);
    const rows = await pg.query<{ n: number }>(`select count(*)::int as n from "lenAgents"`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("a project's and a person's are apart", async () => {
    await upsertAgent("project", "p1", "reviewer", TYPE, "u1");
    await upsertAgent("personal", "u1", "reviewer", TYPE.replace("Review the copy.", "Mine."), "u1");
    expect((await listAgents("project", "p1"))[0]!.text).toBe(TYPE);
    expect((await listAgents("personal", "u1"))[0]!.text).toContain("Mine.");
    expect(await listAgents("personal", "p1")).toEqual([]);
  });

  it("`npm run subagents:migrate` runs twice on the same database", async () => {
    const db2 = new PGlite();
    await db2.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY)`);
    await db2.query(`CREATE TABLE "agentRequestSteps" ("id" text PRIMARY KEY)`);
    for (let i = 0; i < 2; i++) {
      for (const statement of [...CREATE_SUBAGENTS, ...ALTER_SUBAGENT_RUNS, ...ALTER_AGENT_REQUEST_STEPS, ...CREATE_LEN_AGENTS]) await db2.query(statement);
    }
    const cols = await db2.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'lenAgents'`);
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["authorId", "createdAt", "deletedAt", "id", "name", "ownerId", "scope", "text", "updatedAt"]);
  });
});
