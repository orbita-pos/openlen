// @vitest-environment node
//
// HER CONVERSATIONS FOR HER OWNER (spec local 2026-11-06-asistente-propio, §1 «le cuenta qué pasó», §6.5; plan
// …-fase-4e, task 1): what `list_messages` lists in her chat — her visits with the page's visitors, newest first, with
// what she noted from each and a read mark like the page's inbox. Against real Postgres (PGlite), with the tables as
// `npm run assistants:migrate` creates them.
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
const { createAssistant } = await import("../store");
const { saveVisit } = await import("./store");
const { noteRequest } = await import("../requests/store");
const { herConversations, herConversation, markHerVisitsRead } = await import("./inbox");

const NOW = new Date("2026-11-10T18:00:00Z");
const MX = "America/Mexico_City";
let pg: PGlite;
let a1: string;
let a2: string;

const line = (role: "visitor" | "assistant", text: string, at: string) => ({ role, text, at });
async function visit(assistantId: string, projectId: string, visitorId: string, lines: ReturnType<typeof line>[]) {
  await saveVisit({ assistantId, projectId, visitorId, transcript: [], newLines: lines, centicredits: 0, handedOff: false, at: new Date(lines.at(-1)!.at) });
  return (await pg.query<{ id: string }>(`select "id" from "assistantVisits" where "assistantId" = $1 and "projectId" = $2 and "visitorId" = $3`, [assistantId, projectId, visitorId])).rows[0]!.id;
}
const readAtOf = async (id: string) => (await pg.query<{ readAt: Date | null }>(`select "readAt" from "assistantVisits" where "id" = $1`, [id])).rows[0]!.readAt;

let ana: string;
let beto: string;
let carla: string;

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text, "title" text, "subdomain" text, "data" jsonb)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" ("id", "userId", "title") values ('p1', 'u1', 'Pastelería Canela'), ('p2', 'u1', 'Canela Tienda'), ('p3', 'u2', 'Otra')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  const lucia = await createAssistant({ personId: "u1", projectId: "p1", input: { name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" } });
  const otra = await createAssistant({ personId: "u2", projectId: "p3", input: { name: "Bruno", shape: "blob", color: "#88AAFF", tone: "formal" } });
  if (!lucia.ok || !otra.ok) throw new Error("setup");
  a1 = lucia.assistant.id;
  a2 = otra.assistant.id;
  await pg.query(`insert into "assistantProjects" ("projectId", "assistantId", "onPage") values ('p2', $1, false) on conflict do nothing`, [a1]);
  ana = await visit(a1, "p1", "visitorAna00000001", [
    line("visitor", "Hola, ¿qué pasteles tienen?", "2026-11-09T18:33:00.000Z"),
    line("assistant", "Tres leches, chocolate y zanahoria.", "2026-11-09T18:33:10.000Z"),
    line("visitor", "¿Me lo mandan a Zapopan?", "2026-11-09T18:34:00.000Z"),
    line("assistant", "Ya lo anoté para el negocio.", "2026-11-09T18:34:10.000Z"),
  ]);
  beto = await visit(a1, "p2", "visitorBeto0000002", [
    line("visitor", "¿Tienen pastel sin gluten?", "2026-11-09T19:00:00.000Z"),
    line("assistant", "Le paso tu pregunta a los dueños.", "2026-11-09T19:00:10.000Z"),
  ]);
  carla = await visit(a2, "p3", "visitorCarla000003", [line("visitor", "Hola", "2026-11-09T20:00:00.000Z")]);
  await noteRequest({ assistantId: a1, projectId: "p1", visitorId: "visitorAna00000001", text: "Envío a Zapopan", locale: "es", at: new Date("2026-11-09T18:34:05Z") });
  await noteRequest({ assistantId: a1, projectId: "p2", visitorId: "visitorBeto0000002", text: "Pastel sin gluten", locale: "es", at: new Date("2026-11-09T19:00:05Z") });
  await pg.query(
    `insert into "assistantRequestCards" ("id", "assistantId", "projectId", "title", "locale", "status", "visitors", "createdAt", "lastAt") values ('card1', $1, 'p2', 'Pastel sin gluten', 'es', 'dismissed', 1, now(), now())`,
    [a1],
  );
  await pg.query(`update "assistantRequests" set "cardId" = 'card1' where "visitorId" = 'visitorBeto0000002'`);
});

describe("her conversations for her owner", () => {
  it("🔴 lists only her conversations, newest first, with the project's title and what she noted from each", async () => {
    const r = await herConversations(a1, MX, { which: "by_date" }, NOW);
    expect(r.list.map((c) => c.id)).toEqual([beto, ana]);
    expect(r.list[1]).toEqual({
      id: ana,
      project: "Pastelería Canela",
      last: "Ya lo anoté para el negocio.",
      date: "2026-11-09",
      unread: 2,
      noted: [{ request: "Envío a Zapopan", status: "pending" }],
    });
    expect(r.list[0]!.project).toBe("Canela Tienda");
    expect(r.list[0]!.noted).toEqual([{ request: "Pastel sin gluten", status: "dismissed" }]);
    expect(r.list.some((c) => c.id === carla)).toBe(false);
  });

  it("unread counts the visitor's lines after readAt; with no mark, all of them", async () => {
    let r = await herConversations(a1, MX, { which: "unread" }, NOW);
    expect(r).toMatchObject({ conversations: 2, unreadConversations: 2, unreadMessages: 3 });
    expect(await markHerVisitsRead(a1, [ana], new Date("2026-11-09T21:00:00Z"))).toBe(1);
    await visit(a1, "p1", "visitorAna00000001", [line("visitor", "¿Y el sábado abren?", "2026-11-10T10:00:00.000Z")]);
    r = await herConversations(a1, MX, { which: "unread" }, NOW);
    expect(r.list.find((c) => c.id === ana)?.unread).toBe(1);
    expect(r.unreadMessages).toBe(2);
    await markHerVisitsRead(a1, [ana, beto], NOW);
    r = await herConversations(a1, MX, { which: "unread" }, NOW);
    expect(r).toMatchObject({ conversations: 2, unreadConversations: 0, unreadMessages: 0, list: [] });
  });

  it("🔴 by_date uses the owner's zone: a line at 23:30 in Mexico City is that day", async () => {
    const dani = await visit(a1, "p1", "visitorDani0000004", [line("visitor", "¿Abren mañana?", "2026-11-10T05:30:00.000Z")]);
    const day9 = await herConversations(a1, MX, { which: "by_date", from: "2026-11-09", to: "2026-11-09" }, NOW);
    expect(day9.list.map((c) => c.id)).toContain(dani);
    expect(day9.list.find((c) => c.id === dani)?.date).toBe("2026-11-09");
    const day10 = await herConversations(a1, MX, { which: "by_date", from: "2026-11-10", to: "2026-11-10" }, NOW);
    expect(day10.list.map((c) => c.id)).not.toContain(dani);
  });

  it("without a range, by_date is the last 7 days", async () => {
    const eva = await visit(a1, "p1", "visitorEva00000005", [line("visitor", "Hola", "2026-11-02T17:00:00.000Z")]);
    const r = await herConversations(a1, MX, { which: "by_date" }, NOW);
    expect(r.list.map((c) => c.id)).not.toContain(eva);
    expect(r.list.map((c) => c.id)).toContain(ana);
  });

  it("🔴 herConversation is null for another assistant's id; hers has every line as visitor/you", async () => {
    expect(await herConversation(a1, MX, carla)).toBeNull();
    expect(await herConversation(a1, MX, "nope")).toBeNull();
    const c = await herConversation(a1, MX, ana);
    expect(c).toEqual({
      id: ana,
      project: "Pastelería Canela",
      messages: [
        { from: "visitor", text: "Hola, ¿qué pasteles tienen?", date: "2026-11-09" },
        { from: "you", text: "Tres leches, chocolate y zanahoria.", date: "2026-11-09" },
        { from: "visitor", text: "¿Me lo mandan a Zapopan?", date: "2026-11-09" },
        { from: "you", text: "Ya lo anoté para el negocio.", date: "2026-11-09" },
      ],
      noted: [{ request: "Envío a Zapopan", status: "pending" }],
    });
  });

  it("markHerVisitsRead ignores ids that aren't hers", async () => {
    expect(await markHerVisitsRead(a1, [ana, carla, "nope"], NOW)).toBe(1);
    expect(await readAtOf(carla)).toBeNull();
    expect(await readAtOf(ana)).not.toBeNull();
    expect(await markHerVisitsRead(a1, [], NOW)).toBe(0);
  });

  it("the migration adds readAt and runs twice", async () => {
    for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
    const cols = await pg.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns where table_name = 'assistantVisits' and column_name = 'readAt'`,
    );
    expect(cols.rows).toEqual([{ column_name: "readAt", is_nullable: "YES" }]);
  });
});
