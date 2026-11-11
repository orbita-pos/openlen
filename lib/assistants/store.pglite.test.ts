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
const { addAssistantNotice, assistantById, assistantByOldSlug, assistantBySlug, assistantOfProject, assistantsOf, createAssistant, deleteAssistant, readyAssistantNotices, removeAssistantNotices, renameAssistant, saveAssistantMemory, setAssistantLook, setMorningSummary, settleAssistantNotice } = await import("./store");

const LUCIA = { name: "Lucía", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "friendly" } as const;
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

  it("saves her look whole, and her accent is the look's color", async () => {
    const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    if (!r.ok) throw new Error("not created");
    expect(r.assistant.look).toEqual(LUCIA.look);
    expect(r.assistant.color).toBe(LUCIA.look.color);
    const heart = { ...LUCIA.look, shape: "heart", color: "#19c3b1", accessory: "crown" } as const;
    expect(await setAssistantLook(r.assistant.id, "u2", heart)).toBe(false);
    expect((await assistantById(r.assistant.id))?.look).toEqual(LUCIA.look);
    expect(await setAssistantLook(r.assistant.id, "u1", heart)).toBe(true);
    const after = await assistantById(r.assistant.id);
    expect(after?.look).toEqual(heart);
    expect(after?.color).toBe("#19c3b1");
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

  it("keeps how its ask_len requests end, hands the ready ones, and forgets them once heard", async () => {
    const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    if (!r.ok) throw new Error("not created");
    const id = r.assistant.id;
    const at = new Date().toISOString();
    await addAssistantNotice(id, { id: "n1", request: "botón más grande", status: "queued", at });
    await addAssistantNotice(id, { id: "n2", request: "título", status: "queued", at });
    expect(await readyAssistantNotices(id, new Date())).toEqual([]);
    await settleAssistantNotice(id, "n1", { status: "done", closing: "Listo." });
    expect((await readyAssistantNotices(id, new Date())).map((n) => [n.id, n.status, n.closing])).toEqual([["n1", "done", "Listo."]]);
    await removeAssistantNotices(id, ["n1"]);
    expect(await readyAssistantNotices(id, new Date())).toEqual([]);
    expect((await assistantById(id))?.notices.map((n) => n.id)).toEqual(["n2"]);
  });

  it("lists the newest first", async () => {
    await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    await new Promise((r) => setTimeout(r, 5));
    await createAssistant({ personId: "u1", projectId: "p2", input: { ...LUCIA, name: "Ana" } });
    expect((await assistantsOf("u1")).map((a) => a.slug)).toEqual(["ana", "lucia"]);
  });
});

// PHASE 4D (spec §6.8): as Claude Code's /rename, the name changes and the id doesn't; her address follows her name,
// and the old one stays as an alias the page redirects from.
describe("renaming her (phase 4D)", () => {
  async function lucia(projectId = "p1", name = "Lucía"): Promise<string> {
    const r = await createAssistant({ personId: "u1", projectId, input: { ...LUCIA, name } });
    if (!r.ok) throw new Error(r.code);
    return r.assistant.id;
  }

  it("🔴 renaming her moves her address and keeps the old one as an alias", async () => {
    const id = await lucia();
    expect(await renameAssistant(id, "u1", "Marta  Sofía ")).toEqual({ ok: true, name: "Marta Sofía", slug: "marta-sofia" });
    expect((await assistantBySlug("u1", "marta-sofia"))?.id).toBe(id);
    expect(await assistantBySlug("u1", "lucia")).toBeNull();
    expect(await assistantByOldSlug("u1", "lucia")).toEqual({ slug: "marta-sofia" });
    expect(await assistantByOldSlug("u2", "lucia")).toBeNull();
  });

  it("🔴 a name another of hers has is refused and nothing changes", async () => {
    await lucia();
    const ana = await lucia("p2", "Ana");
    expect(await renameAssistant(ana, "u1", "Lucía")).toEqual({ ok: false, error: "name_taken" });
    expect((await assistantById(ana))?.slug).toBe("ana");
    expect(await assistantByOldSlug("u1", "ana")).toBeNull();
  });

  it("going back to an old name takes it back and drops that alias", async () => {
    const id = await lucia();
    await renameAssistant(id, "u1", "Marta");
    expect(await renameAssistant(id, "u1", "Lucía")).toEqual({ ok: true, name: "Lucía", slug: "lucia" });
    expect(await assistantByOldSlug("u1", "lucia")).toBeNull();
    expect(await assistantByOldSlug("u1", "marta")).toEqual({ slug: "lucia" });
  });

  it("🔴 a live slug wins over an alias: an old address that is now another's name opens that one", async () => {
    const first = await lucia();
    await renameAssistant(first, "u1", "Marta");
    const second = await lucia("p2", "Lucía");
    expect((await assistantBySlug("u1", "lucia"))?.id).toBe(second);
  });

  it("🔴 deleting her deletes her aliases", async () => {
    const id = await lucia();
    await renameAssistant(id, "u1", "Marta");
    expect(await deleteAssistant("u1", id)).toBe(true);
    expect(await assistantByOldSlug("u1", "lucia")).toBeNull();
  });

  it("only the case or the accents changed: the name changes, the address doesn't", async () => {
    const id = await lucia();
    expect(await renameAssistant(id, "u1", "LUCIA")).toEqual({ ok: true, name: "LUCIA", slug: "lucia" });
    expect((await assistantById(id))?.name).toBe("LUCIA");
    expect(await assistantByOldSlug("u1", "lucia")).toBeNull();
  });

  it("an empty name, or somebody else's assistant, is refused", async () => {
    const id = await lucia();
    expect(await renameAssistant(id, "u1", "  ")).toEqual({ ok: false, error: "invalid" });
    expect(await renameAssistant(id, "u2", "Marta")).toEqual({ ok: false, error: "not_found" });
    expect((await assistantById(id))?.slug).toBe("lucia");
  });
});

// PHASE 4D (spec §6.9): the morning summary, off unless the owner turns it on, in the language it was turned on in.
describe("the morning summary's switch (phase 4D)", () => {
  async function row(id: string) {
    return (await pg.query<{ morningSummary: boolean; summaryLocale: string | null }>(`select "morningSummary", "summaryLocale" from "assistants" where "id" = $1`, [id])).rows[0];
  }

  it("🔴 the morning summary is off unless the owner turns it on", async () => {
    const off = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    const on = await createAssistant({ personId: "u1", projectId: "p2", input: { ...LUCIA, name: "Ana" }, morningSummary: true, locale: "es" });
    if (!off.ok || !on.ok) throw new Error("not created");
    expect(await row(off.assistant.id)).toEqual({ morningSummary: false, summaryLocale: null });
    expect(await row(on.assistant.id)).toEqual({ morningSummary: true, summaryLocale: "es" });
  });

  it("turning it on keeps the language it was turned on in; off keeps it; only her person", async () => {
    const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
    if (!r.ok) throw new Error(r.code);
    expect(await setMorningSummary(r.assistant.id, "u1", true, "pt")).toBe(true);
    expect(await row(r.assistant.id)).toEqual({ morningSummary: true, summaryLocale: "pt" });
    expect(await setMorningSummary(r.assistant.id, "u1", false, "en")).toBe(true);
    expect(await row(r.assistant.id)).toEqual({ morningSummary: false, summaryLocale: "pt" });
    expect(await setMorningSummary(r.assistant.id, "u2", true, "es")).toBe(false);
  });
});
