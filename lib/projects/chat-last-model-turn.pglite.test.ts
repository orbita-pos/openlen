// @vitest-environment node
//
// THE COLD RETURN (spec local 2026-11-13-conversar-todo-el-mes, piece A): a turn is cold when the
// conversation's last MODEL call ended long ago. That is the last finished turn row with a transcript —
// not the «published» note the card leaves in the chat (a row with no transcript: the stumble of F3), not
// a turn still working, not a message between people, not another conversation. Against Postgres (PGlite).
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

const { lastModelTurnOfTheConversation, lastTurnOfTheConversation } = await import("./chat");

const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const TRANSCRIPT = { mensajes: [{ role: "assistant", content: "done" }], leidos: [] };
let pg: PGlite;

async function row(o: { id: string; minute: number; transcript?: unknown; status?: string; tipo?: string | null; conversation?: string | null; durationMs?: number | null }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "conversation", "transcript", "tipo", "durationMs")
     values ($1, 'p1', 'x', 'ok', $2, $3, $4, $5::jsonb, $6, $7)`,
    [o.id, o.status ?? "applied", at(o.minute), o.conversation ?? null, o.transcript === undefined ? null : JSON.stringify(o.transcript), o.tipo ?? null, o.durationMs ?? null],
  );
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table "projects" ("id" text primary key, "userId" text not null);
    create table "projectChatMessages" (
      "id" text primary key,
      "projectId" text not null references "projects"("id") on delete cascade,
      "userText" text not null, "attachedImage" jsonb, "attachedFiles" jsonb, "assistantReasoning" text not null,
      "page" text, "actions" jsonb, "noDocChange" boolean, "toolResults" jsonb, "transcript" jsonb,
      "status" text not null, "createdAt" timestamp not null default now(),
      "conversation" text, "centicredits" integer, "durationMs" integer, "autorId" text, "origen" jsonb, "tipo" text, "menciones" jsonb, "endReason" text,
      "compaction" jsonb);
    insert into "projects" ("id", "userId") values ('p1', 'u1');
  `);
  base.db = drizzle(pg, { schema });
});

describe("the last turn of a conversation that called the model", () => {
  it("gives the last finished turn that has a transcript, with when it started and how long it took", async () => {
    await row({ id: "t1", minute: 0, transcript: TRANSCRIPT, durationMs: 40_000 });
    await row({ id: "t2", minute: 10, transcript: TRANSCRIPT, durationMs: 90_000 });
    expect(await lastModelTurnOfTheConversation("p1")).toEqual({ createdAt: at(10), durationMs: 90_000 });
  });

  it("a published note after the last turn is not the last model turn", async () => {
    await row({ id: "t1", minute: 0, transcript: TRANSCRIPT, durationMs: 40_000 });
    await row({ id: "pub-1", minute: 120 });
    expect(await lastModelTurnOfTheConversation("p1")).toEqual({ createdAt: at(0), durationMs: 40_000 });
    // The time context asks another question — the last message the model will see — and keeps its answer.
    expect((await lastTurnOfTheConversation("p1"))?.createdAt).toEqual(at(120));
  });

  it("a turn still in progress, a message between people and another conversation do not count", async () => {
    await row({ id: "t1", minute: 0, transcript: TRANSCRIPT, durationMs: 1_000 });
    await row({ id: "working", minute: 30, transcript: { ...TRANSCRIPT, partial: true }, status: "en_curso" });
    await row({ id: "person", minute: 40, transcript: TRANSCRIPT, tipo: "persona" });
    await row({ id: "lucia", minute: 50, transcript: TRANSCRIPT, conversation: "assistant:a1" });
    expect(await lastModelTurnOfTheConversation("p1")).toEqual({ createdAt: at(0), durationMs: 1_000 });
    expect(await lastModelTurnOfTheConversation("p1", "assistant:a1")).toEqual({ createdAt: at(50), durationMs: null });
  });

  it("no turn with a transcript: null", async () => {
    await row({ id: "pub-1", minute: 5 });
    expect(await lastModelTurnOfTheConversation("p1")).toBeNull();
  });
});
