// @vitest-environment node
//
// THE VISUALS A CONVERSATION DREW (spec local 2026-11-22-visuales-de-verdad, §2): what a screen reports names a visual
// by `widgetIdOf(row, k)`; the server keeps only the ones this conversation drew. Every row of the conversation counts,
// not only since the last summary — the person still sees those visuals. Against Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { widgetIdOf } from "@/lib/visuals/widget-id";

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

const { widgetsOfConversation } = await import("./chat");

let pg: PGlite;
const card = (title: string) => ({ tool: "show_widget", status: "done", summary: title, widget: { title, loadingMessages: [], code: "<div></div>" }, textOffset: 0 });

async function fila(o: { id: string; minuto: number; conversation?: string | null; actions: unknown; compaction?: unknown }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "conversation", "actions", "compaction")
     values ($1, 'p1', 'x', 'ok', 'applied', $2, $3, $4::jsonb, $5::jsonb)`,
    [o.id, new Date(Date.now() - (60 - o.minuto) * 60_000), o.conversation ?? null, JSON.stringify(o.actions), o.compaction === undefined ? null : JSON.stringify(o.compaction)],
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

describe("widgetsOfConversation", () => {
  it("names every visual card of the conversation by its row and place, with its title", async () => {
    // A failed show_widget has no `widget`: it is not a visual and doesn't take a place.
    await fila({ id: "r1", minuto: 1, actions: [card("budget"), { tool: "show_widget", status: "error", summary: "x" }, { tool: "Read", status: "done", summary: "y" }, card("spending")] });
    await fila({ id: "r2", minuto: 2, actions: [card("dutch_exercises")], compaction: { summary: "s" } });
    const known = await widgetsOfConversation("p1", null);
    expect([...known]).toEqual([
      [widgetIdOf("r1", 0), "budget"],
      [widgetIdOf("r1", 1), "spending"],
      [widgetIdOf("r2", 0), "dutch_exercises"],
    ]);
  });

  it("another conversation's visuals are not this one's", async () => {
    await fila({ id: "len", minuto: 1, actions: [card("len_chart")] });
    await fila({ id: "ana", minuto: 2, conversation: "assistant:a1", actions: [card("ana_cards")] });
    expect([...(await widgetsOfConversation("p1", "assistant:a1")).keys()]).toEqual([widgetIdOf("ana", 0)]);
    expect([...(await widgetsOfConversation("p1", null)).keys()]).toEqual([widgetIdOf("len", 0)]);
  });

  it("a conversation with no visual has none", async () => {
    await fila({ id: "r1", minuto: 1, actions: [] });
    expect((await widgetsOfConversation("p1", null)).size).toBe(0);
  });
});
