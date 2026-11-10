// @vitest-environment node
//
// THE MORNING SUMMARY'S COUNTS (spec local 2026-11-06-asistente-propio, §6.9, phase 4D), against real Postgres
// (PGlite) with the tables as `npm run assistants:migrate` creates them: what happened YESTERDAY, nothing else.
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
const { countYesterday, dayBounds } = await import("./count");

let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`create table "projectChatMessages" ("id" text primary key, "projectId" text, "conversation" text)`);
  await pg.query(`create table "formSubmissions" ("id" text primary key, "projectId" text not null, "data" jsonb not null, "createdAt" timestamptz not null)`);
  await pg.query(`insert into "users" values ('u1')`);
  await pg.query(`insert into "projects" values ('p1', 'u1'), ('p2', 'u1'), ('p3', 'u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  await pg.query(`insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ('a1', 'u1', 'Lucía', 'lucia', 'blob', '#F4A48B', 'friendly', 'p1'), ('a2', 'u1', 'Ana', 'ana', 'blob', '#F4A48B', 'friendly', 'p3')`);
  base.db = drizzle(pg, { schema });
});

describe("dayBounds", () => {
  it("yesterday in the owner's zone, across a day change in UTC", () => {
    // 2026-11-10 03:30 UTC is still the 9th, 22:30, in Lima (UTC−5).
    const b = dayBounds(new Date("2026-11-10T03:30:00Z"), "America/Lima");
    expect(b.today).toBe("2026-11-09");
    expect(b.hour).toBe(22);
    expect(b.yesterdayStart.toISOString()).toBe("2026-11-08T05:00:00.000Z");
    expect(b.yesterdayEnd.toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });

  it("a zone that doesn't exist is Lima's, the default of the owners' preferences", () => {
    expect(dayBounds(new Date("2026-11-10T03:30:00Z"), "Mars/Olympus").today).toBe("2026-11-09");
  });
});

describe("countYesterday", () => {
  const start = new Date("2026-11-08T05:00:00Z");
  const end = new Date("2026-11-09T05:00:00Z");
  const line = (at: string) => ({ role: "visitor", text: "hola", at });
  async function visit(id: string, assistantId: string, projectId: string, ats: string[]) {
    await pg.query(`insert into "assistantVisits" ("id", "assistantId", "projectId", "visitorId", "startedAt", "lastAt", "lines") values ($1, $2, $3, $1, $4, $5, $6)`, [id, assistantId, projectId, ats[0], ats[ats.length - 1], JSON.stringify(ats.map(line))]);
  }

  it("🔴 counts the people she talked with yesterday, the contacts her bubble's form left and what she noted, nothing from today or the day before", async () => {
    await visit("v1", "a1", "p1", ["2026-11-08T15:00:00Z"]);
    await visit("v2", "a1", "p2", ["2026-11-07T20:00:00Z", "2026-11-08T06:00:00Z"]); // began the day before, talked yesterday
    await visit("v3", "a1", "p1", ["2026-11-07T20:00:00Z"]); // the day before
    await visit("v4", "a1", "p1", ["2026-11-09T06:00:00Z"]); // today
    await visit("v5", "a2", "p3", ["2026-11-08T15:00:00Z"]); // another assistant's
    const form = (id: string, projectId: string, mensaje: string, at: string) =>
      pg.query(`insert into "formSubmissions" values ($1, $2, $3, $4)`, [id, projectId, JSON.stringify({ nombre: "Ana", email: "ana@example.test", mensaje }), at]);
    await form("f1", "p1", "[Asistente] visitor: ¿hacen envíos?", "2026-11-08T16:00:00Z");
    await form("f2", "p2", "[Asistente] visitor: precio", "2026-11-08T17:00:00Z");
    await form("f3", "p1", "Un formulario de la página", "2026-11-08T16:00:00Z"); // the page's own form
    await form("f4", "p1", "[Asistente] visitor: hola", "2026-11-09T07:00:00Z"); // today
    await form("f5", "p3", "[Asistente] visitor: hola", "2026-11-08T16:00:00Z"); // not her project
    const request = (id: string, assistantId: string, at: string) =>
      pg.query(`insert into "assistantRequests" ("id", "assistantId", "projectId", "visitorId", "text", "locale", "at") values ($1, $2, 'p1', 'v', 'envíos', 'es', $3)`, [id, assistantId, at]);
    await request("r1", "a1", "2026-11-08T18:00:00Z");
    await request("r2", "a1", "2026-11-07T18:00:00Z");
    await request("r3", "a2", "2026-11-08T18:00:00Z");
    expect(await countYesterday("a1", ["p1", "p2"], start, end)).toEqual({ talkedWith: 2, contacts: 2, requests: 1 });
  });

  it("a quiet day is all zeros", async () => {
    expect(await countYesterday("a1", ["p1"], start, end)).toEqual({ talkedWith: 0, contacts: 0, requests: 0 });
  });
});
