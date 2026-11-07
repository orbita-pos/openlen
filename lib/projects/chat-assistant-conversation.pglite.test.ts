// @vitest-environment node
//
// THE ASSISTANT'S CONVERSATION APART (spec local 2026-11-06-asistente-propio, §4.1): its rows live in the project's
// chat under `conversation = "assistant:<id>"`; Len's chat, its history, its archived chats and «reopen» never see
// them, and the assistant's turn reads only its own. Against Postgres (PGlite), `projectChatMessages` whole.
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

const { abrirFilaDelTurno, filasParaElHistorialConEquipo, getChatMessages, lastTurnOfTheConversation, latestTodoListForChat, listArchivedConversations, reopenConversation, startNewConversation, turnosParaElHistorial } =
  await import("./chat");

const KEY = "assistant:a1";
let pg: PGlite;

async function fila(o: { id: string; minuto: number; texto: string; conversation?: string | null; actions?: unknown }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "conversation", "actions")
     values ($1, 'p1', $2, 'ok', 'applied', $3, $4, $5::jsonb)`,
    [o.id, o.texto, new Date(Date.now() - (60 - o.minuto) * 60_000), o.conversation ?? null, o.actions === undefined ? null : JSON.stringify(o.actions)],
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
    create table "projectMembers" ("id" text primary key, "projectId" text not null, "userId" text not null, "rol" text not null);
    insert into "projects" ("id", "userId") values ('p1', 'u1');
  `);
  base.db = drizzle(pg, { schema });
  await fila({ id: "len1", minuto: 1, texto: "hola Len" });
  await fila({ id: "luc1", minuto: 2, texto: "hola Lucía", conversation: KEY });
});

describe("the assistant's conversation, apart from Len's", () => {
  it("Len's history never sees the assistant's rows, and the assistant's sees only its own", async () => {
    expect((await turnosParaElHistorial("p1")).map((f) => f.userText)).toEqual(["hola Len"]);
    expect((await turnosParaElHistorial("p1", KEY)).map((f) => f.userText)).toEqual(["hola Lucía"]);
    expect((await filasParaElHistorialConEquipo("p1")).map((f) => f.fila.userText)).toEqual(["hola Len"]);
    expect((await filasParaElHistorialConEquipo("p1", KEY)).map((f) => f.fila.userText)).toEqual(["hola Lucía"]);
  });

  it("the panel's rows and its «load earlier» cursor stay in their conversation", async () => {
    await fila({ id: "luc2", minuto: 3, texto: "¿qué tal ayer?", conversation: KEY });
    expect((await getChatMessages("p1")).map((t) => t.userText)).toEqual(["hola Len"]);
    expect((await getChatMessages("p1", { charla: KEY })).map((t) => t.userText)).toEqual(["hola Lucía", "¿qué tal ayer?"]);
    expect((await getChatMessages("p1", { charla: KEY, before: "luc2" })).map((t) => t.userText)).toEqual(["hola Lucía"]);
    expect(await getChatMessages("p1", { before: "luc2" })).toEqual([]);
  });

  it("a turn's row opens in the conversation it is given", async () => {
    await abrirFilaDelTurno("p1", { id: "luc3", userText: "recuerda esto", page: null }, KEY);
    await abrirFilaDelTurno("p1", { id: "len2", userText: "cambia el título", page: null });
    const r = await pg.query<{ id: string; conversation: string | null }>(`select "id", "conversation" from "projectChatMessages" where "id" in ('luc3', 'len2') order by "id"`);
    expect(r.rows).toEqual([{ id: "len2", conversation: null }, { id: "luc3", conversation: KEY }]);
  });

  it("the time context and the progress list read their own conversation", async () => {
    await fila({ id: "luc4", minuto: 4, texto: "lista", conversation: KEY, actions: [{ tool: "todo_write", status: "done", summary: "x", todos: [{ content: "a", status: "pending" }] }] });
    expect((await lastTurnOfTheConversation("p1"))?.createdAt.getTime()).toBeLessThan((await lastTurnOfTheConversation("p1", KEY))!.createdAt.getTime());
    expect(await latestTodoListForChat("p1")).toBeNull();
  });

  it("an assistant's conversation is not an archived chat, and can't be reopened into Len's", async () => {
    expect((await listArchivedConversations("p1")).map((c) => c.id)).not.toContain(KEY);
    expect(await reopenConversation("p1", KEY)).toEqual({ ok: false, reason: "not_found" });
    expect((await turnosParaElHistorial("p1")).map((f) => f.userText)).toEqual(["hola Len"]);
  });

  it("starting over in Len's chat leaves the assistant's rows alone", async () => {
    await startNewConversation("p1");
    expect(await turnosParaElHistorial("p1")).toEqual([]);
    expect((await turnosParaElHistorial("p1", KEY)).map((f) => f.userText)).toEqual(["hola Lucía"]);
    expect((await listArchivedConversations("p1")).map((c) => c.title)).toEqual(["hola Len"]);
  });
});
