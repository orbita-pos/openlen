// @vitest-environment node
//
// The skills a project and a person keep, against real Postgres (PGlite), with the table as
// `scripts/len-skills-migrate.ts` creates it.
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

const { CREATE_LEN_SKILLS } = await import("@/scripts/len-skills-migrate-sql");
const { deleteSkill, listSkills, upsertSkill } = await import("./store");

const SKILL = "---\nname: cotizar\ndescription: How I quote.\n---\n\nAsk for the size first.\n";

beforeEach(async () => {
  const pg = new PGlite();
  for (const statement of CREATE_LEN_SKILLS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

describe("lenSkills store", () => {
  it("upsert then list returns the text", async () => {
    expect(await upsertSkill("project", "p1", "cotizar", SKILL, "u1")).toEqual({ before: null });
    const list = await listSkills("project", "p1");
    expect(list.map((s) => [s.name, s.text])).toEqual([["cotizar", SKILL]]);
  });

  it("an upsert over a deleted one revives it", async () => {
    await upsertSkill("project", "p1", "cotizar", SKILL, "u1");
    expect(await deleteSkill("project", "p1", "cotizar")).toEqual({ before: SKILL });
    expect(await listSkills("project", "p1")).toEqual([]);
    await upsertSkill("project", "p1", "cotizar", SKILL, "u1");
    expect((await listSkills("project", "p1")).length).toBe(1);
  });

  it("a project's and a person's owners never mix", async () => {
    await upsertSkill("project", "same", "cotizar", SKILL, null);
    await upsertSkill("personal", "same", "otra", SKILL.replace("cotizar", "otra"), null);
    expect((await listSkills("project", "same")).map((s) => s.name)).toEqual(["cotizar"]);
    expect((await listSkills("personal", "same")).map((s) => s.name)).toEqual(["otra"]);
  });

  it("deleting what does not exist says so", async () => {
    expect(await deleteSkill("project", "p1", "nada")).toEqual({ before: null });
  });
});
