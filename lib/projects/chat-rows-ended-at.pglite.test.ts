// @vitest-environment node
//
// THE COLD RETURN (spec local 2026-11-13-conversar-todo-el-mes, piece A): whether a turn is cold is read off
// the rows the turn loads for its history anyway — no query of its own —, so each row says when its turn
// ended: when it started plus how long it took. Against Postgres (PGlite).
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

const { filasParaElHistorialConEquipo, turnosParaElHistorial } = await import("./chat");

const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const TRANSCRIPT = { mensajes: [{ role: "assistant", content: "done" }], leidos: [] };
let pg: PGlite;

async function row(o: { id: string; minute: number; durationMs?: number | null; tipo?: string | null }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "transcript", "tipo", "durationMs")
     values ($1, 'p1', 'x', 'ok', 'applied', $2, $3::jsonb, $4, $5)`,
    [o.id, new Date(T0 + o.minute * 60_000), JSON.stringify(TRANSCRIPT), o.tipo ?? null, o.durationMs ?? null],
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
  await row({ id: "t1", minute: 0, durationMs: 40_000 });
  await row({ id: "t2", minute: 10, durationMs: null });
});

describe("the rows of the history say when their turn ended", () => {
  it("when it started plus how long it took; without a duration, when it started", async () => {
    expect((await turnosParaElHistorial("p1")).map((f) => f.endedAt)).toEqual([T0 + 40_000, T0 + 10 * 60_000]);
  });

  it("the rows of a shared project carry it too", async () => {
    await row({ id: "ana", minute: 5, tipo: "persona" });
    const rows = await filasParaElHistorialConEquipo("p1");
    expect(rows.filter((r) => r.tipo === null).map((r) => r.fila.endedAt)).toEqual([T0 + 40_000, T0 + 10 * 60_000]);
  });
});
