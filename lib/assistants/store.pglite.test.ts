// @vitest-environment node
//
// The person's own assistant (spec local 2026-11-06-asistente-propio), against real Postgres (PGlite), with the
// tables as `npm run assistants:migrate` creates them over minimal users, projects and chat rows.
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
const { assistantById, assistantBySlug, assistantOfProject, assistantsOf, createAssistant, deleteAssistant, saveAssistantMemory } = await import("./store");

const LUCIA = { name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" } as const;
let pg: PGlite;

async function conversationsOf(projectId: string): Promise<(string | null)[]> {
  const r = await pg.query<{ conversation: string | null }>(`select "conversation" from "projectChatMessages" where "projectId" = $1 order by "id"`, [projectId]);
  return r.rows.map((x) => x.conversation);
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "conversation" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('p1', 'u1'), ('p2', 'u1'), ('p3', 'u2')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

describe("assistants store", () => {
  it("creates one and finds it by slug, only for its person", async () => {
    const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    expect(r.ok).toBe(true);
    expect((await assistantBySlug("u1", "lucia"))?.name).toBe("Lucía");
    expect((await assistantBySlug("u1", "lucia"))?.homeProjectId).toBe("p1");
    expect(await assistantBySlug("u2", "lucia")).toBeNull();
    expect((await assistantOfProject("p1"))?.slug).toBe("lucia");
  });

  it("refuses the same name twice for one person", async () => {
    await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    expect(await createAssistant({ personId: "u1", projectId: "p2", input: { ...LUCIA, name: "lucia" } })).toEqual({ ok: false, code: "name_taken" });
    expect(await assistantOfProject("p2")).toBeNull();
  });

  it("lets another person use the same name", async () => {
    await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    expect((await createAssistant({ personId: "u2", projectId: "p3", input: LUCIA })).ok).toBe(true);
  });

  it("refuses a second assistant in one project and leaves no half-made one", async () => {
    await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    expect(await createAssistant({ personId: "u1", projectId: "p1", input: { ...LUCIA, name: "Ana" } })).toEqual({ ok: false, code: "project_has_assistant" });
    expect((await assistantsOf("u1")).map((a) => a.name)).toEqual(["Lucía"]);
  });

  it("deleting it deletes its conversation and nothing else, and only its person can", async () => {
    const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    if (!r.ok) throw new Error("not created");
    await pg.query(`insert into "projectChatMessages" values ('m1', 'p1', null), ('m2', 'p1', $1), ('m3', 'p1', 'c_old')`, [`assistant:${r.assistant.id}`]);
    expect(await deleteAssistant("u2", r.assistant.id)).toBe(false);
    expect(await deleteAssistant("u1", r.assistant.id)).toBe(true);
    expect(await conversationsOf("p1")).toEqual([null, "c_old"]);
    expect(await assistantById(r.assistant.id)).toBeNull();
    expect(await assistantOfProject("p1")).toBeNull();
  });

  it("goes with its project", async () => {
    await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    await pg.query(`delete from "projects" where "id" = 'p1'`);
    expect(await assistantOfProject("p1")).toBeNull();
    expect(await assistantsOf("u1")).toEqual([]);
  });

  it("keeps the memory its owner taught it", async () => {
    const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    if (!r.ok) throw new Error("not created");
    expect(r.assistant.memory).toBe("");
    await saveAssistantMemory(r.assistant.id, "Jueves: pasteles sin gluten.");
    expect((await assistantById(r.assistant.id))?.memory).toBe("Jueves: pasteles sin gluten.");
  });

  it("lists the newest first", async () => {
    await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    await new Promise((r) => setTimeout(r, 5));
    await createAssistant({ personId: "u1", projectId: "p2", input: { ...LUCIA, name: "Ana" } });
    expect((await assistantsOf("u1")).map((a) => a.slug)).toEqual(["ana", "lucia"]);
  });
});
