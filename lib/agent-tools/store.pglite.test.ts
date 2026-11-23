// @vitest-environment node
//
// THE TOOLS OF AN AGENT AND THEIR DATA (spec local 2026-11-22-herramienta-dentro-del-agente, §3): the tool rows and the
// small database they share with the agent, against real Postgres (PGlite) with the tables as `npm run
// assistants:migrate` creates them over minimal users and projects.
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
const { AGENT_TOOL_DATA_MAX_BYTES, AGENT_TOOL_DOC_MAX_BYTES, AGENT_TOOL_DOCS_MAX } = await import("./limits");
const store = await import("./store");

let pg: PGlite;

/** A tool of `teacher`, with its labels derived from the id here (the real ones are HMACs, in a later task). */
function toolInput(o: { id?: string; assistantId?: string; slug?: string; title?: string; releaseSha?: string; hostLabel?: string; phoneHostLabel?: string | null } = {}) {
  const id = o.id ?? "tool-1";
  return {
    id,
    assistantId: o.assistantId ?? "teacher",
    personId: "u1",
    spaceProjectId: "space",
    slug: o.slug ?? "lessons",
    title: o.title ?? "Lessons",
    folder: `/tools/${o.assistantId ?? "teacher"}/${o.slug ?? "lessons"}`,
    releaseSha: o.releaseSha ?? "sha-1",
    hostLabel: o.hostLabel ?? `lienzo-host-${id}`,
    ...(o.phoneHostLabel === undefined ? { phoneHostLabel: `lienzo-phone-${id}` } : { phoneHostLabel: o.phoneHostLabel }),
  };
}

const set = (collection: string, docId: string, data: Record<string, unknown>) => ({ op: "set" as const, collection, docId, data });
const update = (collection: string, docId: string, data: Record<string, unknown>) => ({ op: "update" as const, collection, docId, data });
const del = (collection: string, docId: string) => ({ op: "delete" as const, collection, docId });

/** Document with a JSON of exactly `bytes` bytes. */
const docOfBytes = (bytes: number): Record<string, unknown> => ({ t: "x".repeat(bytes - JSON.stringify({ t: "" }).length) });
const countDocs = async (toolId = "tool-1") => Number((await pg.query<{ n: string }>(`select count(*) as n from "agentToolDocs" where "toolId" = $1`, [toolId])).rows[0]!.n);

async function dataChangedAt(toolId = "tool-1") {
  return (await pg.query<{ d: Date | null }>(`select "dataChangedAt" as d from "agentTools" where "id" = $1`, [toolId])).rows[0]!.d;
}

/** Fills the tool with `n` documents of `bytes` bytes straight into the table (fast), the way earlier writes would have. */
async function seed(n: number, bytes: number, toolId = "tool-1", collection = "seed") {
  await pg.query(
    `insert into "agentToolDocs" ("toolId", "collection", "docId", "data", "bytes", "updatedBy")
     select $1, $2, 'd' || g, '{}'::jsonb, $3, 'agent' from generate_series(1, $4) g`,
    [toolId, collection, bytes, n],
  );
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  for (const [id, person, project, slug] of [["teacher", "u1", "space", "teacher"], ["finance", "u1", "space", "finance"], ["stranger", "u2", "other-space", "stranger"]]) {
    await pg.query(
      `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ($1, $2, $1, $3, 'drop', '#19c3b1', 'friendly', $4)`,
      [id, person, slug, project],
    );
  }
  base.db = drizzle(pg, { schema });
  await store.upsertAgentTool(toolInput());
});

describe("the tool rows", () => {
  it("keeps a tool and finds it by id and by its agent, in the order it was made", async () => {
    const row = await store.agentToolById("tool-1");
    expect(row).toMatchObject({ id: "tool-1", assistantId: "teacher", personId: "u1", spaceProjectId: "space", slug: "lessons", title: "Lessons", folder: "/tools/teacher/lessons", releaseSha: "sha-1", dataChangedAt: null, agentSeenAt: null });
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(await store.agentToolById("nope")).toBeNull();

    await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan", title: "Plan" }));
    await store.upsertAgentTool(toolInput({ id: "tool-3", assistantId: "finance", slug: "budget", title: "Budget" }));
    expect((await store.agentToolsOf("teacher")).map((t) => t.slug)).toEqual(["lessons", "plan"]);
    expect((await store.agentToolsOf("finance")).map((t) => t.slug)).toEqual(["budget"]);
    expect(await store.agentToolsOf("stranger")).toEqual([]);
  });

  it("🔴 publishing again keeps the tool (its id, its address, its data) and moves the version", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { n: 1 })], "agent");
    const again = await store.upsertAgentTool(toolInput({ id: "another-id", title: "Lessons 2", releaseSha: "sha-2", hostLabel: "lienzo-other" }));
    expect(again).toMatchObject({ id: "tool-1", slug: "lessons", title: "Lessons 2", releaseSha: "sha-2", hostLabel: "lienzo-host-tool-1" });
    expect(again.phoneHostLabel).toBe("lienzo-phone-tool-1");
    expect(again.updatedAt.getTime()).toBeGreaterThanOrEqual(again.createdAt.getTime());
    expect(await store.agentToolsOf("teacher")).toHaveLength(1);
    expect(await store.readDocs("tool-1")).toHaveLength(1);
  });

  it("two agents can each have a tool of the same slug", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-f", assistantId: "finance" }));
    expect((await store.agentToolsOf("finance")).map((t) => t.id)).toEqual(["tool-f"]);
    expect((await store.agentToolsOf("teacher")).map((t) => t.id)).toEqual(["tool-1"]);
  });

  it("finds a tool by the label of the workspace or of the phone, and says which one was asked", async () => {
    expect(await store.agentToolByLabel("lienzo-host-tool-1")).toMatchObject({ id: "tool-1", servedTo: "workspace" });
    expect(await store.agentToolByLabel("lienzo-phone-tool-1")).toMatchObject({ id: "tool-1", servedTo: "phone" });
    expect(await store.agentToolByLabel("lienzo-unknown")).toBeNull();
  });

  it("a tool without a phone label is still found by its workspace label", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-9", slug: "nine", phoneHostLabel: null }));
    expect((await store.agentToolById("tool-9"))!.phoneHostLabel).toBeNull();
    expect(await store.agentToolByLabel("lienzo-host-tool-9")).toMatchObject({ id: "tool-9", servedTo: "workspace" });
  });

  it("two tools cannot share an address", async () => {
    await expect(store.upsertAgentTool(toolInput({ id: "tool-8", slug: "eight", hostLabel: "lienzo-host-tool-1" }))).rejects.toThrow();
  });

  it("marks when the agent last looked at its data", async () => {
    const at = new Date("2026-11-22T10:30:00Z");
    await store.markAgentSeen("tool-1", at);
    expect((await store.agentToolById("tool-1"))!.agentSeenAt!.toISOString()).toBe(at.toISOString());
  });
});

describe("writing documents", () => {
  it("set then read: the document is stored whole and reported as a change", async () => {
    const r = await store.writeDocs("tool-1", [set("lessons", "l1", { title: "Greetings", done: false })], "agent");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes).toEqual([{ collection: "lessons", docId: "l1", data: { title: "Greetings", done: false }, updatedAt: expect.any(Date), updatedBy: "agent" }]);
    expect(await store.readDocs("tool-1")).toEqual(r.changes);
    expect(await store.readDocs("tool-1", "lessons")).toEqual(r.changes);
    expect(await store.readDocs("tool-1", "other")).toEqual([]);
  });

  it("set replaces the whole document", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1, y: 2 })], "agent");
    await store.writeDocs("tool-1", [set("c", "a", { z: 3 })], "person");
    const docs = await store.readDocs("tool-1", "c");
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ data: { z: 3 }, updatedBy: "person" });
  });

  it("update merges the top-level fields and leaves the rest; a nested object is replaced, not merged", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1, y: 2, nest: { p: 1, q: 2 } })], "agent");
    const r = await store.writeDocs("tool-1", [update("c", "a", { y: 20, w: 4, nest: { p: 9 } })], "person");
    expect(r.ok && r.changes).toEqual([{ collection: "c", docId: "a", data: { x: 1, y: 20, w: 4, nest: { p: 9 } }, updatedAt: expect.any(Date), updatedBy: "person" }]);
    expect((await store.readDocs("tool-1", "c"))[0]!.data).toEqual({ x: 1, y: 20, w: 4, nest: { p: 9 } });
  });

  it("update on a document that is not there creates it", async () => {
    const r = await store.writeDocs("tool-1", [update("c", "new", { x: 1 })], "agent");
    expect(r.ok).toBe(true);
    expect((await store.readDocs("tool-1", "c"))[0]).toMatchObject({ docId: "new", data: { x: 1 } });
  });

  it("delete removes the document and reports it with null data; deleting what is not there changes nothing", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1 }), set("c", "b", { x: 2 })], "agent");
    const r = await store.writeDocs("tool-1", [del("c", "a"), del("c", "ghost")], "agent");
    expect(r).toEqual({ ok: true, changes: [{ collection: "c", docId: "a", data: null, updatedAt: expect.any(Date), updatedBy: "agent" }] });
    expect((await store.readDocs("tool-1", "c")).map((d) => d.docId)).toEqual(["b"]);
    expect(await store.writeDocs("tool-1", [del("c", "ghost")], "agent")).toEqual({ ok: true, changes: [] });
  });

  it("a batch applies its writes in order, so a later write sees an earlier one", async () => {
    const r = await store.writeDocs("tool-1", [set("c", "a", { x: 1 }), update("c", "a", { y: 2 }), set("c", "b", { x: 1 }), del("c", "b"), set("c", "t", { x: 1 }), del("c", "t"), set("c", "t", { x: 2 })], "agent");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // one change per document the batch left different from how it found it: `b` was made and unmade, so it is not one.
    expect(r.changes.map((c) => [c.docId, c.data])).toEqual([["a", { x: 1, y: 2 }], ["t", { x: 2 }]]);
    expect((await store.readDocs("tool-1", "c")).map((d) => d.docId)).toEqual(["a", "t"]);
  });

  it("documents of two tools do not meet, even with the same collection and id", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan" }));
    await store.writeDocs("tool-1", [set("c", "a", { from: 1 })], "agent");
    await store.writeDocs("tool-2", [set("c", "a", { from: 2 })], "agent");
    expect((await store.readDocs("tool-1", "c"))[0]!.data).toEqual({ from: 1 });
    expect((await store.readDocs("tool-2", "c"))[0]!.data).toEqual({ from: 2 });
  });

  it("reads documents in a stable order: by collection, then by id", async () => {
    await store.writeDocs("tool-1", [set("b", "2", {}), set("a", "9", {}), set("b", "1", {}), set("a", "10", {})], "agent");
    expect((await store.readDocs("tool-1")).map((d) => `${d.collection}/${d.docId}`)).toEqual(["a/10", "a/9", "b/1", "b/2"]);
  });

  it("stores the size of a document as the UTF-8 length of its JSON", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { t: "é😀" })], "agent");
    const row = (await pg.query<{ bytes: number }>(`select "bytes" from "agentToolDocs" where "docId" = 'a'`)).rows[0]!;
    expect(row.bytes).toBe(Buffer.byteLength(JSON.stringify({ t: "é😀" }), "utf8"));
    expect(row.bytes).toBe(JSON.stringify({ t: "" }).length + 2 + 4);
  });
});

describe("reading documents by their keys", () => {
  beforeEach(async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan" }));
    await store.writeDocs("tool-1", [set("b", "2", { n: 1 }), set("a", "9", { n: 2 }), set("b", "1", { n: 3 }), set("a", "10", { n: 4 })], "agent");
    await store.writeDocs("tool-2", [set("a", "9", { from: "another tool" })], "agent");
  });

  it("gives the documents at those keys as they are stored now, in the order of `readDocs`, whatever the order asked", async () => {
    const docs = await store.readDocsByKeys("tool-1", [{ collection: "b", docId: "2" }, { collection: "a", docId: "9" }, { collection: "a", docId: "10" }]);
    expect(docs.map((d) => `${d.collection}/${d.docId}`)).toEqual(["a/10", "a/9", "b/2"]);
    expect(docs.find((d) => d.docId === "9")).toEqual({ collection: "a", docId: "9", data: { n: 2 }, updatedAt: expect.any(Date), updatedBy: "agent" });
    const all = await store.readDocs("tool-1");
    expect(docs).toEqual(all.filter((d) => ["a/10", "a/9", "b/2"].includes(`${d.collection}/${d.docId}`)));
  });

  it("leaves out a key that has no document, and answers nothing for no keys", async () => {
    expect((await store.readDocsByKeys("tool-1", [{ collection: "a", docId: "9" }, { collection: "a", docId: "ghost" }, { collection: "nope", docId: "9" }])).map((d) => d.docId)).toEqual(["9"]);
    expect(await store.readDocsByKeys("tool-1", [])).toEqual([]);
  });

  it("only this tool's documents, and a key means the collection AND the id together", async () => {
    const docs = await store.readDocsByKeys("tool-1", [{ collection: "a", docId: "9" }, { collection: "b", docId: "9" }, { collection: "a", docId: "1" }]);
    expect(docs.map((d) => [d.collection, d.docId, d.data])).toEqual([["a", "9", { n: 2 }]]);
    expect((await store.readDocsByKeys("tool-2", [{ collection: "a", docId: "9" }]))[0]!.data).toEqual({ from: "another tool" });
  });

  it("a key asked twice answers one document; text that looks like SQL is only text", async () => {
    expect(await store.readDocsByKeys("tool-1", [{ collection: "a", docId: "9" }, { collection: "a", docId: "9" }])).toHaveLength(1);
    expect(await store.readDocsByKeys("tool-1", [{ collection: "a'); drop table \"agentToolDocs\"; --", docId: "9" }])).toEqual([]);
    expect(await countDocs()).toBe(4);
  });

  it("readDoc gives one document by its key, only this tool's, or null", async () => {
    expect(await store.readDoc("tool-1", "a", "9")).toEqual({ collection: "a", docId: "9", data: { n: 2 }, updatedAt: expect.any(Date), updatedBy: "agent" });
    expect((await store.readDoc("tool-2", "a", "9"))!.data).toEqual({ from: "another tool" });
    expect(await store.readDoc("tool-1", "b", "9")).toBeNull();
    expect(await store.readDoc("tool-1", "a", "ghost")).toBeNull();
    expect(await store.readDoc("tool-3", "a", "9")).toBeNull();
  });
});

describe("the caps", () => {
  it("are the ones of the spec", () => {
    expect(AGENT_TOOL_DOCS_MAX).toBe(1000);
    expect(AGENT_TOOL_DOC_MAX_BYTES).toBe(64 * 1024);
    expect(AGENT_TOOL_DATA_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("a document of exactly 64 KB is kept; one byte more is `doc_too_big`", async () => {
    expect((await store.writeDocs("tool-1", [set("c", "ok", docOfBytes(AGENT_TOOL_DOC_MAX_BYTES))], "agent")).ok).toBe(true);
    expect(await store.writeDocs("tool-1", [set("c", "big", docOfBytes(AGENT_TOOL_DOC_MAX_BYTES + 1))], "agent")).toEqual({ ok: false, error: "doc_too_big" });
  });

  it("🔴 a batch of two with one too big writes neither", async () => {
    const r = await store.writeDocs("tool-1", [set("c", "small", { x: 1 }), set("c", "big", docOfBytes(AGENT_TOOL_DOC_MAX_BYTES + 1))], "person");
    expect(r).toEqual({ ok: false, error: "doc_too_big" });
    expect(await store.readDocs("tool-1")).toEqual([]);
    expect(await dataChangedAt()).toBeNull();
  });

  it("an update that grows a document past 64 KB is `doc_too_big`, and the document stays as it was", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { keep: "x".repeat(40_000) })], "agent");
    expect(await store.writeDocs("tool-1", [update("c", "a", { more: "y".repeat(40_000) })], "agent")).toEqual({ ok: false, error: "doc_too_big" });
    expect((await store.readDocs("tool-1", "c"))[0]!.data).toEqual({ keep: "x".repeat(40_000) });
  });

  it("🔴 the 1,001st document is `too_many_docs`; writing over one of the 1,000, or swapping one for another, is fine", async () => {
    await seed(AGENT_TOOL_DOCS_MAX, 2);
    expect(await countDocs()).toBe(1000);
    expect(await store.writeDocs("tool-1", [set("seed", "extra", { x: 1 })], "agent")).toEqual({ ok: false, error: "too_many_docs" });
    expect(await countDocs()).toBe(1000);
    expect((await store.writeDocs("tool-1", [set("seed", "d1", { x: 1 })], "agent")).ok).toBe(true);
    expect((await store.writeDocs("tool-1", [del("seed", "d2"), set("seed", "extra", { x: 1 })], "agent")).ok).toBe(true);
    expect(await countDocs()).toBe(1000);
    // two new documents with only one deleted would leave 1,001.
    expect(await store.writeDocs("tool-1", [del("seed", "d3"), set("seed", "e1", {}), set("seed", "e2", {})], "agent")).toEqual({ ok: false, error: "too_many_docs" });
    expect(await countDocs()).toBe(1000);
  });

  it("🔴 the tool's data over 5 MB is `tool_too_big`: nothing of that batch is kept", async () => {
    // 80 documents of exactly 64 KB are exactly 5 MB.
    await seed(80, AGENT_TOOL_DOC_MAX_BYTES);
    const full = await store.writeDocs("tool-1", [set("c", "tiny", { x: 1 })], "agent");
    expect(full).toEqual({ ok: false, error: "tool_too_big" });
    expect(await countDocs()).toBe(80);
    expect(await store.readDocs("tool-1", "c")).toEqual([]);
  });

  it("the total is the sum over the documents the batch would leave: a batch that frees room for itself passes", async () => {
    await seed(80, AGENT_TOOL_DOC_MAX_BYTES);
    // rewriting a 64 KB document smaller makes room for a small one in the same batch.
    const r = await store.writeDocs("tool-1", [set("seed", "d1", { x: 1 }), set("c", "tiny", { x: 1 })], "agent");
    expect(r.ok).toBe(true);
    expect(await countDocs()).toBe(81);
    // and deleting is always allowed, however full.
    expect((await store.writeDocs("tool-1", [del("seed", "d2")], "agent")).ok).toBe(true);
  });

  it("exactly 5 MB is kept", async () => {
    await seed(79, AGENT_TOOL_DOC_MAX_BYTES);
    const room = AGENT_TOOL_DATA_MAX_BYTES - 79 * AGENT_TOOL_DOC_MAX_BYTES;
    expect((await store.writeDocs("tool-1", [set("c", "last", docOfBytes(room))], "agent")).ok).toBe(true);
    expect(await store.writeDocs("tool-1", [set("c", "one-more", { x: 1 })], "agent")).toEqual({ ok: false, error: "tool_too_big" });
  });

  it("the caps are per tool: another tool's data does not count", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan" }));
    await seed(80, AGENT_TOOL_DOC_MAX_BYTES, "tool-2");
    expect((await store.writeDocs("tool-1", [set("c", "a", { x: 1 })], "agent")).ok).toBe(true);
  });
});

describe("what is refused as a bad write", () => {
  const bad = async (w: unknown) => store.writeDocs("tool-1", [w as never], "agent");

  it("a missing, empty or path-like collection or document id, and an operation that does not exist", async () => {
    for (const w of [
      { op: "set", collection: "", docId: "a", data: {} },
      { op: "set", collection: "c", docId: "", data: {} },
      { op: "set", collection: "c/d", docId: "a", data: {} },
      { op: "set", collection: "c", docId: "a/b", data: {} },
      { op: "set", collection: "c", docId: "x".repeat(201), data: {} },
      { op: "set", collection: 5, docId: "a", data: {} },
      { op: "upsert", collection: "c", docId: "a", data: {} },
    ]) {
      expect(await bad(w)).toEqual({ ok: false, error: "bad_write" });
    }
  });

  it("a set or update without an object to store", async () => {
    for (const data of [undefined, null, "text", 7, [1, 2], true]) {
      expect(await bad({ op: "set", collection: "c", docId: "a", data })).toEqual({ ok: false, error: "bad_write" });
      expect(await bad({ op: "update", collection: "c", docId: "a", data })).toEqual({ ok: false, error: "bad_write" });
    }
  });

  it("🔴 text Postgres cannot keep (a NUL, a lone surrogate) is a bad write, never a crash; a literal backslash-u0000 is fine", async () => {
    expect(await bad({ op: "set", collection: "c", docId: "a", data: { t: "x\u0000y" } })).toEqual({ ok: false, error: "bad_write" });
    expect(await bad({ op: "set", collection: "c", docId: "a", data: { "k\u0000": 1 } })).toEqual({ ok: false, error: "bad_write" });
    expect(await bad({ op: "set", collection: "c", docId: "a", data: { t: "\ud800" } })).toEqual({ ok: false, error: "bad_write" });
    expect(await bad({ op: "set", collection: "c", docId: "a", data: { t: "ok 😀" } })).toMatchObject({ ok: true });
    expect(await bad({ op: "set", collection: "c", docId: "b", data: { t: "\\u0000" } })).toMatchObject({ ok: true });
    expect((await store.readDocs("tool-1", "c")).find((d) => d.docId === "b")!.data).toEqual({ t: "\\u0000" });
  });

  it("a value JSON cannot hold, and a cycle", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(await bad({ op: "set", collection: "c", docId: "a", data: { n: BigInt(1) } })).toEqual({ ok: false, error: "bad_write" });
    expect(await bad({ op: "set", collection: "c", docId: "a", data: cyclic })).toEqual({ ok: false, error: "bad_write" });
  });

  it("an object whose JSON is not an object (a Date, a toJSON that returns a list) is a bad write", async () => {
    expect(await bad({ op: "set", collection: "c", docId: "a", data: new Date(0) as unknown as Record<string, unknown> })).toEqual({ ok: false, error: "bad_write" });
    expect(await bad({ op: "update", collection: "c", docId: "a", data: { toJSON: () => [1, 2] } })).toEqual({ ok: false, error: "bad_write" });
    expect(await bad({ op: "set", collection: "c", docId: "a", data: { toJSON: () => "text" } })).toEqual({ ok: false, error: "bad_write" });
  });

  it("🔴 one bad write refuses the whole batch", async () => {
    const r = await store.writeDocs("tool-1", [set("c", "good", { x: 1 }), { op: "set", collection: "", docId: "a", data: {} }], "agent");
    expect(r).toEqual({ ok: false, error: "bad_write" });
    expect(await store.readDocs("tool-1")).toEqual([]);
  });

  it("a tool that is not there", async () => {
    expect(await store.writeDocs("ghost", [set("c", "a", { x: 1 })], "agent")).toEqual({ ok: false, error: "bad_write" });
  });

  it("an empty batch is nothing to do, and succeeds", async () => {
    expect(await store.writeDocs("tool-1", [], "person")).toEqual({ ok: true, changes: [] });
    expect(await dataChangedAt()).toBeNull();
  });
});

describe("who wrote it", () => {
  it("🔴 a person's write sets `dataChangedAt`; an agent's does not", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1 })], "agent");
    expect(await dataChangedAt()).toBeNull();
    const r = await store.writeDocs("tool-1", [set("c", "b", { x: 2 })], "person");
    expect(r.ok).toBe(true);
    const at = await dataChangedAt();
    expect(at).toBeInstanceOf(Date);
    expect(r.ok && r.changes[0]!.updatedAt.getTime()).toBe(at!.getTime());
    const before = at!.getTime();
    await store.writeDocs("tool-1", [set("c", "c", { x: 3 })], "agent");
    expect((await dataChangedAt())!.getTime()).toBe(before);
  });

  it("a person's write that changes nothing (deleting what is not there) does not move it", async () => {
    await store.writeDocs("tool-1", [del("c", "ghost")], "person");
    expect(await dataChangedAt()).toBeNull();
  });

  it("each document says who wrote it last", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1 }), set("c", "b", { x: 1 })], "agent");
    await store.writeDocs("tool-1", [update("c", "b", { x: 2 })], "person");
    expect((await store.readDocs("tool-1", "c")).map((d) => [d.docId, d.updatedBy])).toEqual([["a", "agent"], ["b", "person"]]);
  });
});

describe("what a tool's data belongs to", () => {
  beforeEach(async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan" }));
    await store.upsertAgentTool(toolInput({ id: "tool-f", assistantId: "finance", slug: "budget" }));
    for (const id of ["tool-1", "tool-2", "tool-f"]) await store.writeDocs(id, [set("c", "a", { x: 1 })], "agent");
  });

  it("🔴 deleting the tool deletes its data for good, and no other tool's", async () => {
    expect(await store.deleteAgentTool("tool-1")).toBe(true);
    expect(await store.agentToolById("tool-1")).toBeNull();
    expect(await store.readDocs("tool-1")).toEqual([]);
    expect(await countDocs("tool-2")).toBe(1);
    expect(await countDocs("tool-f")).toBe(1);
    expect(await store.deleteAgentTool("tool-1")).toBe(false);
  });

  it("🔴 deleting the agent deletes its tools and their data, and no one else's", async () => {
    await pg.query(`delete from "assistants" where "id" = 'teacher'`);
    expect(await store.agentToolsOf("teacher")).toEqual([]);
    expect(await countDocs("tool-1")).toBe(0);
    expect(await countDocs("tool-2")).toBe(0);
    expect((await store.agentToolsOf("finance")).map((t) => t.id)).toEqual(["tool-f"]);
    expect(await countDocs("tool-f")).toBe(1);
  });

  it("deleting the person's space deletes the tools made in it", async () => {
    await pg.query(`delete from "projects" where "id" = 'space'`);
    expect(await pg.query(`select 1 from "agentTools"`).then((r) => r.rows)).toEqual([]);
    expect(await pg.query(`select 1 from "agentToolDocs"`).then((r) => r.rows)).toEqual([]);
  });
});
