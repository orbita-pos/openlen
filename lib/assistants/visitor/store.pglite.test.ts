// @vitest-environment node
//
// THE VISITORS' SIDE OF THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.7, §6.5, §6.6), against
// real Postgres (PGlite), with the tables as `npm run assistants:migrate` creates them.
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
const { assistantById, createAssistant, deleteAssistant, oldAssistantSettings, projectIsApp, switchOldAssistantOff } = await import("../store");
const visitor = await import("./store");

const LUCIA = { name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" } as const;
const DAY = 86_400_000;
let pg: PGlite;
let lucia: string;

const line = (role: "visitor" | "assistant", text: string, at: Date) => ({ role, text, at: at.toISOString() });

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text, "data" jsonb, "updatedAt" timestamp)`);
  await pg.query(`create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "conversation" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('p1', 'u1'), ('p2', 'u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
  if (!r.ok) throw new Error("setup");
  lucia = r.assistant.id;
});

describe("visits", () => {
  it("a visitor's messages build ONE visit: lines in order, count and spend add up", async () => {
    const t1 = new Date("2026-11-07T10:00:00Z");
    const t2 = new Date("2026-11-07T10:01:00Z");
    await visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", transcript: [{ role: "user", content: "a" }], newLines: [line("visitor", "¿horario?", t1), line("assistant", "9 a 19", t1)], centicredits: 7, handedOff: false, at: t1 });
    await visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", transcript: [{ role: "user", content: "b" }], newLines: [line("visitor", "¿sin gluten?", t2), line("assistant", "jueves", t2)], centicredits: 5, handedOff: true, at: t2 });
    const v = await visitor.visitOf(lucia, "p1", "vid-aaaaaaaaaaaaaaaa");
    expect(v).not.toBeNull();
    expect(v!.messageCount).toBe(2);
    expect(v!.centicredits).toBe(12);
    expect(v!.handedOff).toBe(true);
    expect((v!.lines as { text: string }[]).map((l) => l.text)).toEqual(["¿horario?", "9 a 19", "¿sin gluten?", "jueves"]);
    expect(v!.transcript).toEqual([{ role: "user", content: "b" }]);
    expect(v!.lastAt.toISOString()).toBe(t2.toISOString());
    expect(v!.startedAt.toISOString()).toBe(t1.toISOString());
    expect((await visitor.visitsOf(lucia, 50, t2)).length).toBe(1);
  });

  it("🔴 a visit 90 days quiet is gone at the next save; one 89 days quiet stays", async () => {
    const now = new Date("2026-11-07T10:00:00Z");
    const save = (vid: string, at: Date) =>
      visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: vid, transcript: [], newLines: [line("visitor", "hola", at)], centicredits: 1, handedOff: false, at });
    await save("old-aaaaaaaaaaaaaaaa", new Date(now.getTime() - 90 * DAY - 1000));
    await save("kept-aaaaaaaaaaaaaaa", new Date(now.getTime() - 89 * DAY));
    await save("new-aaaaaaaaaaaaaaaa", now);
    const ids = (await visitor.visitsOf(lucia, 50, now)).map((v) => v.visitorId);
    expect(ids).toEqual(["new-aaaaaaaaaaaaaaaa", "kept-aaaaaaaaaaaaaaa"]);
  });

  // Final review, Important 3: with no new visitor message the write-time prune never runs.
  it("🔴 the owner never reads a visit 90 days quiet, and reading forgets it — even with no new message", async () => {
    const now = new Date("2026-11-07T10:00:00Z");
    const save = (vid: string, at: Date) =>
      visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: vid, transcript: [], newLines: [line("visitor", "hola", at)], centicredits: 1, handedOff: false, at });
    await save("kept-aaaaaaaaaaaaaaa", new Date(now.getTime() - 89 * DAY));
    await save("old-aaaaaaaaaaaaaaaa", new Date(now.getTime() - 90 * DAY - 1000));
    expect((await visitor.visitsOf(lucia, 50, now)).map((v) => v.visitorId)).toEqual(["kept-aaaaaaaaaaaaaaa"]);
    const r = await pg.query<{ n: number }>(`select count(*)::int as n from "assistantVisits"`);
    expect(r.rows[0]!.n).toBe(1);
  });

  // Deferred minor: a chatty visitor's row grew forever, and «Conversaciones» read it whole.
  it("🔴 a visit keeps its last 200 lines, in order", async () => {
    const at = new Date("2026-11-07T10:00:00Z");
    const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => line(i % 2 ? "assistant" : "visitor", `l${from + i}`, at));
    await visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", transcript: [], newLines: many(0, 150), centicredits: 1, handedOff: false, at });
    await visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", transcript: [], newLines: many(150, 60), centicredits: 1, handedOff: false, at });
    const lines = (await visitor.visitOf(lucia, "p1", "vid-aaaaaaaaaaaaaaaa"))!.lines as { text: string }[];
    expect(lines).toHaveLength(visitor.VISIT_MAX_LINES);
    expect(visitor.VISIT_MAX_LINES).toBe(200);
    expect(lines[0]!.text).toBe("l10");
    expect(lines.at(-1)!.text).toBe("l209");
  });

  it("deleting the assistant deletes its visits", async () => {
    const at = new Date();
    await visitor.saveVisit({ assistantId: lucia, projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", transcript: [], newLines: [line("visitor", "hola", at)], centicredits: 1, handedOff: false, at });
    expect(await deleteAssistant("u1", lucia)).toBe(true);
    const r = await pg.query<{ n: number }>(`select count(*)::int as n from "assistantVisits"`);
    expect(r.rows[0]!.n).toBe(0);
  });
});

describe("on the page", () => {
  it("onPage is off by default; setOnPage only for the assistant of that project", async () => {
    expect(await visitor.assistantOnPage("p1")).toBeNull();
    expect(await visitor.setOnPage("p2", lucia, true)).toBe(false);
    expect(await visitor.setOnPage("p1", "someone-else", true)).toBe(false);
    expect(await visitor.setOnPage("p1", lucia, true)).toBe(true);
    const on = await visitor.assistantOnPage("p1");
    expect(on?.assistant.id).toBe(lucia);
    expect(on?.knowledge).toBeNull();
    await visitor.saveKnowledge("p1", "Pastelería Canela. Martes a domingo.", new Date());
    expect((await visitor.assistantOnPage("p1"))?.knowledge).toBe("Pastelería Canela. Martes a domingo.");
    expect(await visitor.setOnPage("p1", lucia, false)).toBe(true);
    expect(await visitor.assistantOnPage("p1")).toBeNull();
  });

  it("🔴 turning her on or off forgets what she knew: she answers only after a publish with her", async () => {
    await visitor.setOnPage("p1", lucia, true);
    await visitor.saveKnowledge("p1", "Lo publicado.", new Date());
    await visitor.setOnPage("p1", lucia, false);
    await visitor.setOnPage("p1", lucia, true);
    expect((await visitor.assistantOnPage("p1"))?.knowledge).toBeNull();
  });

  // Final review (Minor 2, re-graded Important): a stale second tab re-sending «on» hid her live bubble.
  it("🔴 «on» again while she is on keeps what she knows: her live bubble stays", async () => {
    await visitor.setOnPage("p1", lucia, true);
    await visitor.saveKnowledge("p1", "Lo publicado.", new Date());
    expect(await visitor.setOnPage("p1", lucia, true)).toBe(true);
    expect((await visitor.assistantOnPage("p1"))?.knowledge).toBe("Lo publicado.");
  });
});

describe("the visitors' month", () => {
  it("the month's spend adds up per account", async () => {
    await visitor.addMonthSpend("u1", "2026-11", 30);
    await visitor.addMonthSpend("u1", "2026-11", 12);
    await visitor.addMonthSpend("u1", "2026-12", 5);
    expect(await visitor.monthSpent("u1", "2026-11")).toBe(42);
    expect(await visitor.monthSpent("u1", "2026-12")).toBe(5);
    expect(await visitor.monthSpent("u2", "2026-11")).toBe(0);
  });

  it("claimAsleepAlert is true once per month and reason", async () => {
    expect(await visitor.claimAsleepAlert("u1", "2026-11", "cap")).toBe(true);
    expect(await visitor.claimAsleepAlert("u1", "2026-11", "cap")).toBe(false);
    expect(await visitor.claimAsleepAlert("u1", "2026-11", "credits")).toBe(true);
    expect(await visitor.claimAsleepAlert("u1", "2026-12", "cap")).toBe(true);
  });

  it("the owner's own cap: none by default, kept when set, cleared with null", async () => {
    expect(await visitor.explicitVisitorCap("u1")).toBeNull();
    await visitor.setExplicitVisitorCap("u1", 1500);
    expect(await visitor.explicitVisitorCap("u1")).toBe(1500);
    await visitor.setExplicitVisitorCap("u1", null);
    expect(await visitor.explicitVisitorCap("u1")).toBeNull();
  });
});

describe("today's assistant, for her memory (§6.4)", () => {
  it("reads the old assistant's settings of a project, and creates her with the memory it is given", async () => {
    await pg.query(`update "projects" set "data" = $1 where "id" = 'p2'`, [{ settings: { assistant: { enabled: true, facts: "Envíos sólo en Guadalajara.", tone: "formal" } } }]);
    expect(await oldAssistantSettings("p2")).toEqual({ enabled: true, facts: "Envíos sólo en Guadalajara.", tone: "formal" });
    expect(await oldAssistantSettings("p1")).toBeUndefined();
    const r = await createAssistant({ personId: "u1", projectId: "p2", input: { ...LUCIA, name: "Pan" }, memory: "# Lo que me enseñaron antes" });
    if (!r.ok) throw new Error("not created");
    expect((await assistantById(r.assistant.id))?.memory).toBe("# Lo que me enseñaron antes");
  });

  it("tells an app or a game from a page", async () => {
    await pg.query(`update "projects" set "data" = $1 where "id" = 'p2'`, [{ html: "<div id=root></div>", app: { catalogo: "2026-11", entrada: "/src/main.jsx" } }]);
    expect(await projectIsApp("p2")).toBe(true);
    await pg.query(`update "projects" set "data" = $1 where "id" = 'p1'`, [{ html: "<h1>Pan</h1>" }]);
    expect(await projectIsApp("p1")).toBe(false);
    expect(await projectIsApp("nope")).toBe(false);
  });

  it("🔴 switching today's assistant off touches only its switch, once", async () => {
    await pg.query(`update "projects" set "data" = $1 where "id" = 'p2'`, [{ html: "<h1>x</h1>", settings: { assistant: { enabled: true, facts: "Jueves sin gluten." }, chat: { enabled: true } } }]);
    expect(await switchOldAssistantOff("p2")).toBe(true);
    const r = await pg.query<{ data: { html: string; settings: { assistant: { enabled: boolean; facts: string }; chat: { enabled: boolean } } } }>(`select "data" from "projects" where "id" = 'p2'`);
    expect(r.rows[0]!.data).toEqual({ html: "<h1>x</h1>", settings: { assistant: { enabled: false, facts: "Jueves sin gluten." }, chat: { enabled: true } } });
    expect(await switchOldAssistantOff("p2")).toBe(false);
    expect(await switchOldAssistantOff("p1")).toBe(false);
  });
});
