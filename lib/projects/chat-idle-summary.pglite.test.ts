// @vitest-environment node
//
// THE IDLE SUMMARY (spec local 2026-11-13-conversar-todo-el-mes, piece B): the summary written while a
// conversation sat idle WAITS on its turn's row, inside the transcript, and changes nothing the history
// sends. A turn that comes back cold promotes it to the row's compaction mark, and from then on the history
// starts at the summary. Only the conversation's last model turn can be promoted. Against Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import type { CompactionMark } from "@/lib/agent/compaction/mark";
import { SUMMARY_CLOSE_TAG, SUMMARY_OPEN_TAG } from "@/lib/agent/compaction/summary-prompt";
import type { PendingIdleSummary } from "@/lib/agent/idle-summary";
import { historialDesdeLaBase } from "@/lib/agent/transcripcion";

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

const { promoteIdleSummary, savePendingIdleSummary, startNewConversation, turnosParaElHistorial } = await import("./chat");

const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const transcriptOf = (answer: string) => ({ mensajes: [{ role: "assistant", content: answer }], leidos: [] });
const MARK: CompactionMark = {
  messages: [{ role: "user", content: `${SUMMARY_OPEN_TAG}\nwhat was done\n${SUMMARY_CLOSE_TAG}` }],
  fromTranscript: 1,
  trigger: "idle",
  preTokens: 120_000,
  postTokens: 9_000,
  skills: [],
};
const PENDING: PendingIdleSummary = { mark: MARK, writtenAt: "2026-11-13T10:00:00.000Z" };
let pg: PGlite;

async function row(o: { id: string; minute: number; transcript?: unknown; conversation?: string | null; compaction?: unknown; status?: string }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "conversation", "transcript", "compaction")
     values ($1, 'p1', $2, 'ok', $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      o.id,
      `ask ${o.id}`,
      o.status ?? "applied",
      new Date(T0 + o.minute * 60_000),
      o.conversation ?? null,
      o.transcript === undefined ? null : JSON.stringify(o.transcript),
      o.compaction === undefined ? null : JSON.stringify(o.compaction),
    ],
  );
}

const stored = async (id: string) =>
  (await pg.query<{ transcript: Record<string, unknown> | null; compaction: unknown }>(`select "transcript", "compaction" from "projectChatMessages" where "id" = $1`, [id])).rows[0]!;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table "projects" ("id" text primary key, "userId" text not null);
    create table "users" ("id" text primary key, "name" text, "email" text);
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
  await row({ id: "t1", minute: 0, transcript: transcriptOf("first") });
  await row({ id: "t2", minute: 10, transcript: transcriptOf("second") });
});

describe("a summary written while idle waits on its row", () => {
  it("is saved next to the transcript, and the history still sends the conversation whole", async () => {
    const before = historialDesdeLaBase(await turnosParaElHistorial("p1"));
    await savePendingIdleSummary("p1", "t2", PENDING);
    expect((await stored("t2")).transcript).toMatchObject({ idleSummary: PENDING, mensajes: [{ role: "assistant", content: "second" }] });
    expect((await stored("t2")).compaction).toBeNull();
    const rows = await turnosParaElHistorial("p1");
    expect(rows).toHaveLength(2);
    expect(historialDesdeLaBase(rows)).toEqual(before);
  });

  it("a row with no transcript, or one that already has a mark, is left alone", async () => {
    await row({ id: "pub-1", minute: 20 });
    await row({ id: "t3", minute: 30, transcript: transcriptOf("third"), compaction: { ...MARK, trigger: "pressure" } });
    await savePendingIdleSummary("p1", "pub-1", PENDING);
    await savePendingIdleSummary("p1", "t3", PENDING);
    expect((await stored("pub-1")).transcript).toBeNull();
    expect((await stored("t3")).transcript).not.toHaveProperty("idleSummary");
  });

  it("another project's row is not touched", async () => {
    await savePendingIdleSummary("another-project", "t2", PENDING);
    expect((await stored("t2")).transcript).not.toHaveProperty("idleSummary");
  });
});

describe("a cold turn promotes the summary that was waiting", () => {
  it("the row gets the mark, the pending copy goes, and the history starts at the summary", async () => {
    await savePendingIdleSummary("p1", "t2", PENDING);
    expect(await promoteIdleSummary("p1")).toBe(true);
    expect((await stored("t2")).compaction).toEqual(MARK);
    expect((await stored("t2")).transcript).not.toHaveProperty("idleSummary");
    const rows = await turnosParaElHistorial("p1");
    expect(rows).toHaveLength(1);
    const history = historialDesdeLaBase(rows);
    expect(history).toHaveLength(1);
    expect(history[0]!.content).toContain(SUMMARY_OPEN_TAG);
    // Nothing left to promote.
    expect(await promoteIdleSummary("p1")).toBe(false);
  });

  it("nothing waiting: nothing changes", async () => {
    expect(await promoteIdleSummary("p1")).toBe(false);
    expect(await turnosParaElHistorial("p1")).toHaveLength(2);
  });

  it("a summary waiting on a row that is no longer the last turn is not promoted", async () => {
    await savePendingIdleSummary("p1", "t1", PENDING);
    expect(await promoteIdleSummary("p1")).toBe(false);
    expect((await stored("t1")).compaction).toBeNull();
    expect((await stored("t1")).transcript).toMatchObject({ idleSummary: PENDING });
  });

  it("the published note, a turn that kept only its state and a turn still working do not hide the last turn", async () => {
    await savePendingIdleSummary("p1", "t2", PENDING);
    await row({ id: "pub-1", minute: 20 });
    await row({ id: "state", minute: 21, transcript: { mensajes: [], leidos: [], planMode: true } });
    await row({ id: "working", minute: 22, transcript: { ...transcriptOf("…"), partial: true }, status: "en_curso" });
    expect(await promoteIdleSummary("p1")).toBe(true);
    const history = historialDesdeLaBase(await turnosParaElHistorial("p1"));
    expect(history[0]!.content).toContain(SUMMARY_OPEN_TAG);
    expect(history.map((m) => m.content)).toContain("ask pub-1");
  });

  it("after «start from scratch» the old conversation's summary is not promoted into the new one", async () => {
    await savePendingIdleSummary("p1", "t2", PENDING);
    await startNewConversation("p1");
    expect(await promoteIdleSummary("p1")).toBe(false);
    expect((await stored("t2")).compaction).toBeNull();
  });

  it("the assistant's conversation promotes its own, not the project chat's", async () => {
    await row({ id: "luc1", minute: 5, transcript: transcriptOf("hola"), conversation: "assistant:a1" });
    await savePendingIdleSummary("p1", "luc1", PENDING);
    expect(await promoteIdleSummary("p1")).toBe(false);
    expect(await promoteIdleSummary("p1", "assistant:a1")).toBe(true);
    expect((await stored("luc1")).compaction).toEqual(MARK);
    expect((await stored("t2")).compaction).toBeNull();
  });

  it("something waiting that is not a mark is never promoted", async () => {
    await pg.query(`update "projectChatMessages" set "transcript" = jsonb_set("transcript", '{idleSummary}', '{"mark":{"trigger":"idle"},"writtenAt":"x"}'::jsonb) where "id" = 't2'`);
    expect(await promoteIdleSummary("p1")).toBe(false);
    expect(await turnosParaElHistorial("p1")).toHaveLength(2);
  });
});
