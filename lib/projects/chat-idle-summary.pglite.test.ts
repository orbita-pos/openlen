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
import type { Message } from "@/lib/ai-gateway";
import type { CompactionMark } from "@/lib/agent/compaction/mark";
import { foldMemoryDigests } from "@/lib/agent/memory/memory-messages";
import { foldLoadedSkills } from "@/lib/agent/skills/tool";
import { SUMMARY_CLOSE_TAG, SUMMARY_OPEN_TAG } from "@/lib/agent/compaction/summary-prompt";
import { runIdleSummary, type PendingIdleSummary } from "@/lib/agent/idle-summary";
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

const { clearPendingIdleSummaries, isLastModelTurn, promoteIdleSummary, savePendingIdleSummary, startNewConversation, turnosParaElHistorial } = await import("./chat");

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

// The whole path with the real pieces — the summary, the row, the history — and only the model made up.
describe("written while idle, ignored while warm, applied cold, and the turn after rebuilds it", () => {
  const reads = (n: number): Message[] =>
    Array.from({ length: 6 }, (_, k): Message[] => [
      { role: "assistant", content: "", reasoning: "thinking " + n, functionCalls: [{ name: "Read", args: { file_path: "/src/f" + n + "-" + k + ".ts" } }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: (n + "-" + k + ":").padEnd(7_000, "x") } }] },
    ]).flat();
  const HEAD: Message[] = [{ role: "system", content: "SYSTEM" }, { role: "user", content: "MANUAL" }];

  it("the first row of a conversation, with its memory and a loaded skill", async () => {
    await pg.query(`delete from "projectChatMessages"`);
    const first = { mensajes: [...reads(1), { role: "assistant", content: "Hecho." }], leidos: [], memoria: "Contents of /LEN.md: be brief", memoriaHuellas: { "/LEN.md": "abc" }, skillsLoaded: ["game-development"], contexto: "CONTEXT 1" };
    await row({ id: "a1", minute: 0, transcript: first });
    const before = historialDesdeLaBase(await turnosParaElHistorial("p1"));

    // The timer fires: the request is what the turn sent, and its summary waits on the row.
    let asked: Message[] = [];
    const outcome = await runIdleSummary(
      {
        key: "p1:",
        messages: [...HEAD, ...(before as Message[])],
        firstIndex: 2,
        transcriptLength: first.mensajes.length,
        minTokens: 1_000,
        // The real question, against the real row.
        stillCurrent: () => isLastModelTurn("p1", null, "a1"),
        canAfford: async () => true,
        summarize: async (request) => ((asked = request), { text: "## Primary Request and Intent\n- read six files", usage: null }),
        charge: async () => {},
        save: (pending) => savePendingIdleSummary("p1", "a1", pending),
      },
      new AbortController().signal,
    );
    expect(outcome).toBe("saved");
    expect(asked.slice(0, -1)).toEqual([...HEAD, ...before].slice(0, asked.length - 1));

    // While warm: the conversation goes on whole, byte for byte.
    expect(historialDesdeLaBase(await turnosParaElHistorial("p1"))).toEqual(before);

    // A turn comes back cold: it starts from the summary, and nothing of the row is believed to be in view.
    expect(await promoteIdleSummary("p1")).toBe(true);
    const coldRows = await turnosParaElHistorial("p1");
    const sentByColdTurn = historialDesdeLaBase(coldRows);
    expect(sentByColdTurn[0]!.content).toContain(SUMMARY_OPEN_TAG);
    expect(sentByColdTurn.length).toBeLessThan(before.length);
    expect(sentByColdTurn.map((m) => m.content)).not.toContain("Contents of /LEN.md: be brief");
    expect(foldMemoryDigests(coldRows)).toBeNull();
    expect(foldLoadedSkills(coldRows).size).toBe(0);

    // And the turn after it starts with the very bytes the cold turn sent.
    await row({ id: "a2", minute: 180, transcript: { mensajes: [{ role: "assistant", content: "Sigo." }], leidos: [], contexto: "CONTEXT 2" } });
    const next = historialDesdeLaBase(await turnosParaElHistorial("p1"));
    expect(next.slice(0, sentByColdTurn.length)).toEqual(sentByColdTurn);
  });
});

// Asked when a summary's timer fires (Claude Code checks again at that moment): is the row it was armed for
// still the conversation's last model turn?
describe("isLastModelTurn", () => {
  it("the last finished turn with messages is; an older one is not", async () => {
    expect(await isLastModelTurn("p1", null, "t2")).toBe(true);
    expect(await isLastModelTurn("p1", null, "t1")).toBe(false);
  });

  it("a published note behind it changes nothing; a newer turn does", async () => {
    await row({ id: "pub-1", minute: 20 });
    expect(await isLastModelTurn("p1", null, "t2")).toBe(true);
    await row({ id: "t3", minute: 30, transcript: transcriptOf("third") });
    expect(await isLastModelTurn("p1", null, "t2")).toBe(false);
  });

  // Len Watch works in a copy and writes its row in the parent's chat: its turn does not cancel the parent's timer.
  it("not while another turn of the conversation is running: its row will come after this one", async () => {
    await row({ id: "watch-1", minute: 30, status: "en_curso" });
    expect(await isLastModelTurn("p1", null, "t2")).toBe(false);
    // A turn running in another conversation of the project is not this one's business.
    await pg.query(`update "projectChatMessages" set "conversation" = 'assistant:a1' where "id" = 'watch-1'`);
    expect(await isLastModelTurn("p1", null, "t2")).toBe(true);
  });

  it("not after «start from scratch», not once its row is gone, not when it already has a mark", async () => {
    await row({ id: "luc1", minute: 5, transcript: transcriptOf("hola"), conversation: "assistant:a1" });
    expect(await isLastModelTurn("p1", "assistant:a1", "luc1")).toBe(true);
    await pg.query(`delete from "projectChatMessages" where "id" = 'luc1'`);
    expect(await isLastModelTurn("p1", "assistant:a1", "luc1")).toBe(false);
    await pg.query(`update "projectChatMessages" set "compaction" = $1::jsonb where "id" = 't2'`, [JSON.stringify(MARK)]);
    expect(await isLastModelTurn("p1", null, "t2")).toBe(false);
    await pg.query(`update "projectChatMessages" set "compaction" = null where "id" = 't2'`);
    await startNewConversation("p1");
    expect(await isLastModelTurn("p1", null, "t2")).toBe(false);
  });
});

// A summary that was waiting and was not used is dropped when the conversation goes on, as Claude Code drops
// the one it holds when a newer request arrives: it no longer covers what came after, and it would be loaded
// with every later turn.
describe("clearPendingIdleSummaries", () => {
  it("drops every summary waiting in the conversation and leaves the transcripts as they were", async () => {
    await row({ id: "luc1", minute: 5, transcript: transcriptOf("hola"), conversation: "assistant:a1" });
    await savePendingIdleSummary("p1", "t1", PENDING);
    await savePendingIdleSummary("p1", "t2", PENDING);
    await savePendingIdleSummary("p1", "luc1", PENDING);
    await clearPendingIdleSummaries("p1");
    expect((await stored("t1")).transcript).toEqual(transcriptOf("first"));
    expect((await stored("t2")).transcript).toEqual(transcriptOf("second"));
    // Another conversation's is not this turn's business.
    expect((await stored("luc1")).transcript).toMatchObject({ idleSummary: PENDING });
    await clearPendingIdleSummaries("p1", "assistant:a1");
    expect((await stored("luc1")).transcript).toEqual(transcriptOf("hola"));
  });
});
