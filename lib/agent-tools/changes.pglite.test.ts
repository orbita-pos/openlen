// @vitest-environment node
//
// WHAT CHANGED IN AN AGENT'S TOOLS (spec local 2026-11-22-herramienta-dentro-del-agente, §4): against real Postgres
// (PGlite), a person's write shows up in `changedSince` until `markAgentSeen` moves past it; an agent's own write never
// does; and a deletion-only change names the tool without collections.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const store = await import("./store");
const { changedSince, toolChangesLine } = await import("./changes");

let pg: PGlite;
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1')`);
  await pg.query(`insert into "projects" values ('space', 'u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  await pg.query(
    `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ('ana', 'u1', 'Ana', 'ana', 'drop', '#19c3b1', 'friendly', 'space')`,
  );
  base.db = drizzle(pg, { schema });
  await store.upsertAgentTool({
    id: "tool-1",
    assistantId: "ana",
    personId: "u1",
    spaceProjectId: "space",
    slug: "recorrido",
    title: "Recorrido",
    folder: "/tools/ana/recorrido",
    releaseSha: "sha-1",
    hostLabel: "lienzo-host-1",
    phoneHostLabel: "lienzo-phone-1",
  });
});

afterEach(async () => {
  await pg?.close();
});

describe("changedSince against Postgres", () => {
  it("reports person writes, ignores agent writes, clears after markAgentSeen, and handles deletion-only changes", async () => {
    // Nothing written yet.
    expect(await changedSince("ana")).toEqual([]);

    // Agent's own write: still nothing.
    await store.writeDocs("tool-1", [{ op: "set", collection: "lessons", docId: "1", data: { unlocked: true } }], "agent");
    expect(await changedSince("ana")).toEqual([]);

    // Person writes progress/3 and notes/1.
    await tick();
    await store.writeDocs(
      "tool-1",
      [
        { op: "set", collection: "progress", docId: "3", data: { score: 9 } },
        { op: "set", collection: "notes", docId: "1", data: { text: "hola" } },
      ],
      "person",
    );
    const first = await changedSince("ana");
    expect(first).toEqual([{ title: "Recorrido", slug: "recorrido", collections: ["notes", "progress"] }]);
    expect(toolChangesLine(first)).toContain("recorrido");
    expect(toolChangesLine(first)).toContain("notes, progress");

    // Agent reads/writes -> markAgentSeen clears it.
    await tick();
    await store.markAgentSeen("tool-1", new Date());
    expect(await changedSince("ana")).toEqual([]);

    // Person writes ONLY progress/4 while agent writes lessons/2 -> only progress reported (not notes from earlier, not lessons).
    await tick();
    await store.writeDocs("tool-1", [{ op: "set", collection: "progress", docId: "4", data: { score: 10 } }], "person");
    await store.writeDocs("tool-1", [{ op: "set", collection: "lessons", docId: "2", data: { unlocked: true } }], "agent");
    expect(await changedSince("ana")).toEqual([{ title: "Recorrido", slug: "recorrido", collections: ["progress"] }]);

    // Seen again, then person only deletes a document -> tool reported with empty collections.
    await tick();
    await store.markAgentSeen("tool-1", new Date());
    await tick();
    await store.writeDocs("tool-1", [{ op: "delete", collection: "progress", docId: "4" }], "person");
    const delOnly = await changedSince("ana");
    expect(delOnly).toEqual([{ title: "Recorrido", slug: "recorrido", collections: [] }]);
    expect(toolChangesLine(delOnly).toLowerCase()).toContain("removed");
  });
});
