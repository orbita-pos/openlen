// @vitest-environment node
//
// POST /api/agent-tools/[id]/data (spec local 2026-11-22-herramienta-dentro-del-agente, §3–§4): where the bridge's `data.*`
// land — a tool's page reading and writing the small database it shares with its agent, with the PERSON's session (or the
// phone's key). Against the real store (PGlite) with the tables as `npm run assistants:migrate` creates them, so what a
// write does to `dataChangedAt` and to the rows is what production does.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, person: "u1" as string | null }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn(async () => base.person) }));

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { AGENT_TOOL_DOC_MAX_BYTES, AGENT_TOOL_DOCS_MAX } = await import("@/lib/agent-tools/limits");
const { subscribeToolChanges } = await import("@/lib/agent-tools/bus");
const store = await import("@/lib/agent-tools/store");
const route = await import("./route");

let pg: PGlite;
let unsubscribe: (() => void) | null = null;
const heard: unknown[] = [];

function toolInput(o: { id: string; assistantId?: string; personId?: string; slug?: string }) {
  return {
    id: o.id,
    assistantId: o.assistantId ?? "teacher",
    personId: o.personId ?? "u1",
    spaceProjectId: "space",
    slug: o.slug ?? "lessons",
    title: "Lessons",
    folder: `/tools/${o.assistantId ?? "teacher"}/${o.slug ?? "lessons"}`,
    releaseSha: "sha-1",
    hostLabel: `lienzo-host-${o.id}`,
    phoneHostLabel: `lienzo-phone-${o.id}`,
  };
}

const post = (body: unknown, id = "tool-1", headers: Record<string, string> = {}) =>
  route.POST(new Request(`https://openlen.com/api/agent-tools/${id}/data`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const call = async (body: unknown, id = "tool-1") => {
  const res = await post(body, id);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const dataChangedAt = async (toolId = "tool-1") => (await pg.query<{ d: Date | null }>(`select "dataChangedAt" as d from "agentTools" where "id" = $1`, [toolId])).rows[0]!.d;
const countDocs = async (toolId = "tool-1") => Number((await pg.query<{ n: string }>(`select count(*) as n from "agentToolDocs" where "toolId" = $1`, [toolId])).rows[0]!.n);

// One database for the file (making one costs more than a test): the tables once, the tools and their documents afresh.
beforeAll(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  for (const [id, person, project] of [["teacher", "u1", "space"], ["stranger", "u2", "other-space"]]) {
    await pg.query(
      `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ($1, $2, $1, $1, 'drop', '#19c3b1', 'friendly', $3)`,
      [id, person, project],
    );
  }
  base.db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  base.person = "u1";
  heard.length = 0;
  await pg.query(`delete from "agentTools"`); // its documents go with it
  await store.upsertAgentTool(toolInput({ id: "tool-1" }));
  await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan" }));
  await store.upsertAgentTool(toolInput({ id: "tool-x", assistantId: "stranger", personId: "u2", slug: "theirs" }));
  unsubscribe = subscribeToolChanges("tool-1", (change) => heard.push(change));
});

afterEach(() => {
  unsubscribe?.();
  vi.unstubAllEnvs();
});

describe("the owner's writes", () => {
  it("set stores the document as the person, answers it as JSON and tells everyone following the tool", async () => {
    const r = await call({ op: "set", collection: "lessons", docId: "l1", data: { title: "Greetings", done: false } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, doc: { collection: "lessons", docId: "l1", data: { title: "Greetings", done: false }, updatedAt: expect.any(String), updatedBy: "person" } });
    expect(new Date(r.body.doc.updatedAt).toISOString()).toBe(r.body.doc.updatedAt);

    const stored = await store.readDocs("tool-1", "lessons");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ docId: "l1", data: { title: "Greetings", done: false }, updatedBy: "person" });
    expect(stored[0]!.updatedAt.toISOString()).toBe(r.body.doc.updatedAt);

    expect(heard).toEqual([{ by: "person", docs: [expect.objectContaining({ collection: "lessons", docId: "l1", data: { title: "Greetings", done: false }, updatedBy: "person" })], deleted: [] }]);
  });

  it("🔴 a write by the person marks dataChangedAt, which is what the agent is told changed", async () => {
    expect(await dataChangedAt()).toBeNull();
    await call({ op: "set", collection: "c", docId: "a", data: { x: 1 } });
    expect(await dataChangedAt()).toBeInstanceOf(Date);
    expect(await dataChangedAt("tool-2")).toBeNull();
  });

  it("update merges the top-level fields, and creates the document when it isn't there", async () => {
    await call({ op: "set", collection: "c", docId: "a", data: { x: 1, y: 2 } });
    const merged = await call({ op: "update", collection: "c", docId: "a", data: { y: 20, z: 3 } });
    expect(merged.body.doc).toMatchObject({ docId: "a", data: { x: 1, y: 20, z: 3 }, updatedBy: "person" });
    const created = await call({ op: "update", collection: "c", docId: "fresh", data: { w: 1 } });
    expect(created.body.doc).toMatchObject({ docId: "fresh", data: { w: 1 } });
    expect(heard).toHaveLength(3);
  });

  it("delete answers doc: null and publishes the removal; deleting what isn't there changes and publishes nothing", async () => {
    await call({ op: "set", collection: "c", docId: "a", data: { x: 1 } });
    heard.length = 0;
    expect(await call({ op: "delete", collection: "c", docId: "a" })).toEqual({ status: 200, body: { ok: true, doc: null } });
    expect(await store.readDocs("tool-1", "c")).toEqual([]);
    expect(heard).toEqual([{ by: "person", docs: [], deleted: [{ collection: "c", docId: "a" }] }]);

    heard.length = 0;
    expect(await call({ op: "delete", collection: "c", docId: "ghost" })).toEqual({ status: 200, body: { ok: true, doc: null } });
    expect(heard).toEqual([]);
  });

  it("its writes land in this tool and no other, even with the same collection and id", async () => {
    await call({ op: "set", collection: "c", docId: "a", data: { from: 1 } });
    await call({ op: "set", collection: "c", docId: "a", data: { from: 2 } }, "tool-2");
    expect((await store.readDocs("tool-1", "c"))[0]!.data).toEqual({ from: 1 });
    expect((await store.readDocs("tool-2", "c"))[0]!.data).toEqual({ from: 2 });
  });

  it("a document over 64 KB is a 400 doc_too_big: nothing stored, nothing published, nothing marked", async () => {
    const big = { t: "x".repeat(AGENT_TOOL_DOC_MAX_BYTES) };
    expect(await call({ op: "set", collection: "c", docId: "a", data: big })).toEqual({ status: 400, body: { error: "doc_too_big" } });
    expect(await countDocs()).toBe(0);
    expect(heard).toEqual([]);
    expect(await dataChangedAt()).toBeNull();
  });

  it("a full database is a 400 too_many_docs", async () => {
    await pg.query(
      `insert into "agentToolDocs" ("toolId", "collection", "docId", "data", "bytes", "updatedBy")
       select 'tool-1', 'seed', 'd' || g, '{}'::jsonb, 2, 'agent' from generate_series(1, $1::int) g`,
      [AGENT_TOOL_DOCS_MAX],
    );
    expect(await call({ op: "set", collection: "c", docId: "one-more", data: {} })).toEqual({ status: 400, body: { error: "too_many_docs" } });
    expect(heard).toEqual([]);
  });

  it("a name the store can't keep is a 400 bad_write", async () => {
    expect(await call({ op: "set", collection: "a/b", docId: "d", data: {} })).toEqual({ status: 400, body: { error: "bad_write" } });
    expect(await countDocs()).toBe(0);
  });
});

describe("the owner's reads", () => {
  beforeEach(async () => {
    await store.writeDocs(
      "tool-1",
      [
        { op: "set", collection: "lessons", docId: "l1", data: { n: 1, tag: "a", deep: { k: 5 } } },
        { op: "set", collection: "lessons", docId: "l2", data: { n: 3, tag: "b" } },
        { op: "set", collection: "lessons", docId: "l3", data: { n: 2, tag: "a" } },
        { op: "set", collection: "other", docId: "o1", data: { n: 9 } },
      ],
      "agent",
    );
    await store.writeDocs("tool-2", [{ op: "set", collection: "lessons", docId: "l1", data: { n: 100 } }], "agent");
    heard.length = 0;
  });

  it("get answers the document as JSON, or null", async () => {
    const found = await call({ op: "get", collection: "lessons", docId: "l1" });
    expect(found).toEqual({ status: 200, body: { doc: { collection: "lessons", docId: "l1", data: { n: 1, tag: "a", deep: { k: 5 } }, updatedAt: expect.any(String), updatedBy: "agent" } } });
    expect(await call({ op: "get", collection: "lessons", docId: "nope" })).toEqual({ status: 200, body: { doc: null } });
    expect(await call({ op: "get", collection: "nope", docId: "l1" })).toEqual({ status: 200, body: { doc: null } });
  });

  it("list answers the whole collection, in order, and no other", async () => {
    const r = await call({ op: "list", collection: "lessons" });
    expect(r.status).toBe(200);
    expect(r.body.docs.map((d: { docId: string }) => d.docId)).toEqual(["l1", "l2", "l3"]);
    expect(r.body.docs[0]).toMatchObject({ collection: "lessons", updatedBy: "agent" });
    expect(await call({ op: "list", collection: "empty" })).toEqual({ status: 200, body: { docs: [] } });
  });

  it("query filters, orders and limits like the agent's", async () => {
    const ids = async (query: unknown) => (await call({ op: "query", collection: "lessons", query })).body.docs.map((d: { docId: string }) => d.docId);
    expect(await ids({ where: [{ field: "tag", op: "==", value: "a" }] })).toEqual(["l1", "l3"]);
    expect(await ids({ orderBy: { field: "n", direction: "desc" } })).toEqual(["l2", "l3", "l1"]);
    expect(await ids({ where: [{ field: "n", op: ">=", value: 2 }], orderBy: { field: "n" }, limit: 1 })).toEqual(["l3"]);
    expect(await ids({ where: [{ field: "deep.k", op: "==", value: 5 }] })).toEqual(["l1"]);
    expect(await ids(undefined)).toEqual(["l1", "l2", "l3"]);
  });

  it("a read publishes nothing and marks nothing", async () => {
    await call({ op: "list", collection: "lessons" });
    await call({ op: "get", collection: "lessons", docId: "l1" });
    expect(heard).toEqual([]);
    expect(await dataChangedAt()).toBeNull();
  });
});

describe("a call that is wrong", () => {
  const bad = async (body: unknown) => {
    const r = await call(body);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bad_request");
    expect(typeof r.body.message).toBe("string");
    return r.body.message as string;
  };

  it("says in a sentence what is wrong, with the page's own names", async () => {
    expect(await bad({ op: "get", docId: "d" })).toBe("collection is required for get.");
    expect(await bad({ op: "get", collection: "c" })).toBe("docId is required for get.");
    expect(await bad({ op: "set", collection: "c", docId: "d" })).toBe("data is required for set: the document, a JSON object.");
    expect(await bad({ op: "update", collection: "c", docId: "d", data: [1] })).toBe("data is required for update: the document, a JSON object.");
    expect(await bad({ op: "delete", collection: "c" })).toBe("docId is required for delete.");
    expect(await bad({ op: "query", collection: "c", query: { limit: 0 } })).toMatch(/query\.limit must be a whole number/);
    expect(await bad({ op: "query", collection: "c", query: { where: [{ field: "a", op: "like", value: 1 }] } })).toMatch(/query\.where\[0\]\.op must be one of/);
    expect(await bad({ op: "list" })).toBe("collection is required for list.");
  });

  it("an op it doesn't have — batch is the agent's — is a 400", async () => {
    expect(await bad({ op: "batch", writes: [] })).toMatch(/op must be one of get, list, query, set, update, delete/);
    expect(await bad({ op: "drop" })).toMatch(/op must be one of/);
    expect(await bad({})).toMatch(/op must be one of/);
  });

  it("a body that isn't a JSON object is a 400", async () => {
    for (const body of ["not json", "[]", "7", "null"]) {
      const res = await post(body);
      expect(res.status, body).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("bad_request");
    }
  });

  it("a body past 256 KB is a 413 and nothing is written, whether its content-length says so or not", async () => {
    const big = JSON.stringify({ op: "set", collection: "c", docId: "d", data: { t: "x".repeat(256 * 1024) } });
    // A content-length past the cap is refused before a byte is read (here the body itself is small).
    const declared = await post({ op: "set", collection: "c", docId: "d", data: { t: "x" } }, "tool-1", { "content-length": String(300 * 1024) });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "payload_too_large" });
    // A big body (Node's Request sends no content-length for it) is read no further than the cap.
    const undeclared = await post(big);
    expect(undeclared.status).toBe(413);
    // A stream with no content-length is read no further than the cap.
    const chunk = new TextEncoder().encode(big);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk);
        c.close();
      },
    });
    const streamed = await route.POST(
      new Request("https://openlen.com/api/agent-tools/tool-1/data", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit),
      { params: Promise.resolve({ id: "tool-1" }) },
    );
    expect(streamed.status).toBe(413);
    expect(await countDocs()).toBe(0);
    expect(heard).toEqual([]);
    // Just under the cap is read and checked as usual (here the store's own 64 KB cap answers).
    const under = await post({ op: "set", collection: "c", docId: "d", data: { t: "x".repeat(100 * 1024) } });
    expect(under.status).toBe(400);
    expect(((await under.json()) as { error: string }).error).toBe("doc_too_big");
  });

  it("nothing a bad call does reaches the database", async () => {
    await bad({ op: "set", collection: "c", docId: "d", data: "x" });
    expect(await countDocs()).toBe(0);
    expect(heard).toEqual([]);
  });
});

describe("🔴 who may", () => {
  const body = { op: "set", collection: "c", docId: "d", data: { stolen: true } };

  it("another person gets the same 404 as a tool that doesn't exist, for every op", async () => {
    await store.writeDocs("tool-1", [{ op: "set", collection: "c", docId: "d", data: { mine: true } }], "agent");
    heard.length = 0;
    base.person = "u2";
    const missing = await call(body, "no-such-tool");
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });
    for (const op of ["get", "list", "query", "set", "update", "delete"]) {
      expect(await call({ ...body, op }), op).toEqual(missing);
    }
    expect((await store.readDocs("tool-1", "c"))[0]).toMatchObject({ data: { mine: true }, updatedBy: "agent" });
    expect(heard).toEqual([]);
    expect(await dataChangedAt()).toBeNull();
  });

  it("their own tool still works for them", async () => {
    base.person = "u2";
    expect((await call(body, "tool-x")).status).toBe(200);
    expect(await store.readDocs("tool-x", "c")).toHaveLength(1);
    expect(await call(body, "tool-1")).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("nobody signed in, no key: the same 404", async () => {
    base.person = null;
    expect(await call(body)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await countDocs()).toBe(0);
  });

  it("with the tools switched off: the same 404, and nothing happens", async () => {
    vi.stubEnv("OPENLEN_AGENT_TOOLS", "0");
    expect(await call(body)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await countDocs()).toBe(0);
    expect(heard).toEqual([]);
  });

  it("a stranger can't tell a tool exists by the body they send: a malformed body is a 404 for them, not a 400", async () => {
    base.person = "u2";
    expect((await post("not json")).status).toBe(404);
    expect((await call({ op: "nope" })).status).toBe(404);
  });

  it("there is no plan check on this path: the route never asks for the person's plan or credits", async () => {
    // The route runs here with no credits or plan tables (its `users` table has no plan column): reaching for a plan would throw. Free or paid, it answers.
    expect((await call(body)).status).toBe(200);
  });
});

describe("for the phone's app", () => {
  it("answers the app's origin with CORS, and the preflight too", async () => {
    const res = await post({ op: "get", collection: "c", docId: "d" }, "tool-1", { origin: "https://localhost" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const pre = route.OPTIONS(new Request("https://openlen.com/api/agent-tools/tool-1/data", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("another origin gets none", async () => {
    const res = await post({ op: "get", collection: "c", docId: "d" }, "tool-1", { origin: "https://evil.example" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is never cached", async () => {
    expect((await post({ op: "get", collection: "c", docId: "d" })).headers.get("cache-control")).toBe("no-store");
  });
});
