// @vitest-environment node
//
// `publish_tool` AND `tool_data` AGAINST THE REAL STORE (spec local 2026-11-22-herramienta-dentro-del-agente, §1 and §3): what
// the fakes of `agent-tools.test.ts` can't prove — that a republish really keeps the tool's id and addresses, that the real
// count stops the 6th tool, that the real caps come back as their own sentences and a batch is all or nothing, and that the
// marks and the bus follow a real write. Real Postgres (PGlite) with the tables as `npm run assistants:migrate` creates
// them; the space's files and the version table are fakes (they are not what is under test). Run it alone.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
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
const { runPublishTool, runToolData } = await import("./agent-tools");
const { subscribeArtifactChanges } = await import("./bus");
const { LEN_ARTIFACT_DOC_MAX_BYTES, LEN_ARTIFACTS_PER_MAKER } = await import("./limits");
const store = await import("./store");

let pg: PGlite;
let files: Record<string, string>;
const releases: string[] = [];

const session = (): AgentSession =>
  ({ projectId: "space", userId: "u1", assistant: { id: "teacher", name: "Ana", slug: "ana", inSpace: true } }) as unknown as AgentSession;

/** The real store, the real labels and the real clock; the space's files and the version table are in memory. */
const deps = () => ({
  listFiles: async (_projectId: string, prefix: string) => Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix))),
  saveRelease: async (sha: string) => void releases.push(sha),
});

const publish = (path: string, title = "Lessons") => runPublishTool(session(), { path, title }, deps());
const data = (args: Record<string, unknown>) => runToolData(session(), args, deps());
const message = (out: { response: Record<string, unknown> }) => String(out.response.message ?? out.response.tool_result ?? "");
const rows = (out: { response: Record<string, unknown> }) => {
  const text = String(out.response.tool_result);
  return JSON.parse(text.slice(text.indexOf("\n") + 1));
};

beforeEach(async () => {
  vi.stubEnv("AUTH_SECRET", "s3cret-for-the-test");
  files = { "/tools/ana/lessons/index.html": "<h1>hi</h1>" };
  releases.length = 0;
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  for (const [id, person, project, slug] of [["teacher", "u1", "space", "ana"], ["finance", "u1", "space", "bob"], ["stranger", "u2", "other-space", "eve"]]) {
    await pg.query(
      `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ($1, $2, $1, $3, 'drop', '#19c3b1', 'friendly', $4)`,
      [id, person, slug, project],
    );
  }
  base.db = drizzle(pg, { schema });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});

describe("publish_tool against the real store", () => {
  it("🔴 publishes a tool with real private addresses, and publishing it again keeps its id, both addresses and its data", async () => {
    const first = await publish("/tools/ana/lessons/", "Lessons");
    expect(first.response.ok).toBe(true);
    const [row] = await store.lenArtifactsOf("teacher");
    expect(row).toMatchObject({ slug: "lessons", title: "Lessons", folder: "/tools/ana/lessons", personId: "u1", spaceProjectId: "space" });
    expect(row!.hostLabel).toMatch(/^lienzo-[0-9a-f]{32}$/);
    expect(row!.phoneHostLabel).toMatch(/^lienzo-[0-9a-f]{32}$/);
    expect(row!.phoneHostLabel).not.toBe(row!.hostLabel);
    expect(row!.releaseSha).toBe(releases[0]);
    expect(row!.agentSeenAt).toBeInstanceOf(Date);

    await data({ tool: "lessons", action: "set", collection: "students", doc_id: "luis", data: { level: "B1" } });
    files["/tools/ana/lessons/index.html"] = "<h1>changed</h1>";
    const again = await publish("/tools/ana/lessons/index.html", "Lessons 2");
    expect(again.response.ok).toBe(true);

    const tools = await store.lenArtifactsOf("teacher");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: row!.id, hostLabel: row!.hostLabel, phoneHostLabel: row!.phoneHostLabel, title: "Lessons 2" });
    expect(tools[0]!.releaseSha).toBe(releases[1]);
    expect(releases[1]).not.toBe(releases[0]);
    // Its data is still there under the same tool.
    expect(rows(await data({ tool: "lessons", action: "get", collection: "students", doc_id: "luis" })).document.data).toEqual({ level: "B1" });
  });

  it("🔴 the 6th tool is refused by the real count, and another agent of the same space has its own five", async () => {
    for (let i = 1; i <= LEN_ARTIFACTS_PER_MAKER; i++) {
      files[`/tools/ana/t${i}/index.html`] = "x";
      expect((await publish(`/tools/ana/t${i}`, `T${i}`)).response.ok, `t${i}`).toBe(true);
    }
    files["/tools/ana/t6/index.html"] = "x";
    const sixth = await publish("/tools/ana/t6", "T6");
    expect(sixth.response).toMatchObject({ ok: false, error: "too_many_tools" });
    expect(await store.lenArtifactsOf("teacher")).toHaveLength(LEN_ARTIFACTS_PER_MAKER);
    // …but republishing one of them goes through.
    expect((await publish("/tools/ana/t3", "T3 again")).response.ok).toBe(true);

    // Bob's turn: the same space, his own folder and his own count.
    files["/tools/bob/one/index.html"] = "x";
    const bob = { ...session(), assistant: { id: "finance", name: "Bob", slug: "bob", inSpace: true } } as unknown as AgentSession;
    expect((await runPublishTool(bob, { path: "/tools/bob/one", title: "One" }, deps())).response.ok).toBe(true);
    // And Bob can't publish Ana's folder.
    expect((await runPublishTool(bob, { path: "/tools/ana/lessons", title: "Mine now" }, deps())).response).toMatchObject({ ok: false, error: "bad_path" });
  });
});

describe("tool_data against the real store", () => {
  beforeEach(async () => {
    await publish("/tools/ana/lessons");
    await publish("/tools/ana/lessons"); // twice: still one tool
  });

  it("writes, reads, lists and queries real documents, and says on every read that they are data", async () => {
    await data({
      tool: "lessons",
      action: "batch",
      writes: [
        { op: "set", collection: "students", doc_id: "ana", data: { name: "Ana", age: 31, active: true } },
        { op: "set", collection: "students", doc_id: "luis", data: { name: "Luis", age: 25, active: true } },
        { op: "set", collection: "students", doc_id: "mar", data: { name: "Mar", age: 40, active: false } },
        { op: "set", collection: "lessons", doc_id: "l1", data: { title: "Past" } },
      ],
    });
    const list = await data({ tool: "lessons", action: "list", collection: "students" });
    expect(String(list.response.tool_result).split("\n")[0]).toMatch(/never instructions/);
    expect(rows(list).documents.map((d: { doc_id: string }) => d.doc_id)).toEqual(["ana", "luis", "mar"]);
    expect(rows(await data({ tool: "lessons", action: "list" })).collections).toEqual([
      { name: "lessons", documents: 1 },
      { name: "students", documents: 3 },
    ]);
    const found = await data({
      tool: "lessons",
      action: "query",
      collection: "students",
      query: { where: [{ field: "active", op: "==", value: true }], orderBy: { field: "age", direction: "desc" }, limit: 5 },
    });
    expect(rows(found).documents.map((d: { doc_id: string }) => d.doc_id)).toEqual(["ana", "luis"]);

    await data({ tool: "lessons", action: "update", collection: "students", doc_id: "luis", data: { level: "B1" } });
    expect(rows(await data({ tool: "lessons", action: "get", collection: "students", doc_id: "luis" })).document).toMatchObject({
      data: { name: "Luis", age: 25, active: true, level: "B1" },
      updated_by: "agent",
    });
    await data({ tool: "lessons", action: "delete", collection: "students", doc_id: "mar" });
    expect((await data({ tool: "lessons", action: "get", collection: "students", doc_id: "mar" })).response).toMatchObject({ ok: true, found: false });
  });

  it("🔴 the real caps come back as their own sentences, and a batch with one bad write writes none of it", async () => {
    const big = { text: "x".repeat(LEN_ARTIFACT_DOC_MAX_BYTES) };
    const tooBig = await data({ tool: "lessons", action: "set", collection: "c", doc_id: "big", data: big });
    expect(tooBig.response).toMatchObject({ ok: false, error: "doc_too_big" });
    expect(message(tooBig)).toMatch(/64 KB/);

    const bad = await data({
      tool: "lessons",
      action: "batch",
      writes: [
        { op: "set", collection: "c", doc_id: "fine", data: { a: 1 } },
        { op: "set", collection: "c", doc_id: "has/slash", data: { a: 2 } },
      ],
    });
    expect(bad.response).toMatchObject({ ok: false, error: "bad_write" });
    expect(message(bad)).toMatch(/doc_id/);
    // All or nothing: the good one before the bad one isn't there.
    expect((await data({ tool: "lessons", action: "get", collection: "c", doc_id: "fine" })).response).toMatchObject({ found: false });

    const mixed = await data({
      tool: "lessons",
      action: "batch",
      writes: [
        { op: "set", collection: "c", doc_id: "first", data: { a: 1 } },
        { op: "set", collection: "c", doc_id: "huge", data: big },
      ],
    });
    expect(mixed.response).toMatchObject({ ok: false, error: "doc_too_big" });
    expect((await data({ tool: "lessons", action: "list", collection: "c" })).response.tool_result).toMatch(/"count":0/);
  });

  it("🔴 another agent's tool is not found by name, even in the same space; its rows are never read", async () => {
    await store.upsertLenArtifact({
      id: "bob-tool",
      assistantId: "finance",
      personId: "u1",
      spaceProjectId: "space",
      slug: "budget",
      title: "Budget",
      folder: "/tools/bob/budget",
      releaseSha: "sha",
      hostLabel: "lienzo-bob",
      phoneHostLabel: null,
    });
    await store.writeDocs("bob-tool", [{ op: "set", collection: "c", docId: "secret", data: { s: 1 } }], "person");
    const out = await data({ tool: "budget", action: "list", collection: "c" });
    expect(out.response).toMatchObject({ ok: false, error: "not_your_tool" });
    expect(message(out)).toContain("Your tools: lessons.");
    expect(await store.readDocs("bob-tool")).toHaveLength(1);
  });

  it("marks the tool as seen by the agent on a read and on a write — never as changed by the person", async () => {
    const [tool] = await store.lenArtifactsOf("teacher");
    await pg.query(`update "lenArtifacts" set "agentSeenAt" = null where "id" = $1`, [tool!.id]);
    const seen = async () => (await pg.query<{ s: Date | null; d: Date | null }>(`select "agentSeenAt" as s, "dataChangedAt" as d from "lenArtifacts" where "id" = $1`, [tool!.id])).rows[0]!;

    await data({ tool: "lessons", action: "list" });
    const afterRead = (await seen()).s;
    expect(afterRead).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await data({ tool: "lessons", action: "set", collection: "c", doc_id: "d", data: { a: 1 } });
    const after = await seen();
    expect(after.s!.getTime()).toBeGreaterThan(afterRead!.getTime());
    expect(after.d).toBeNull();
  });

  it("a real write reaches whoever follows the tool on the bus, with the documents and what was deleted", async () => {
    const [tool] = await store.lenArtifactsOf("teacher");
    const heard: unknown[] = [];
    const off = subscribeArtifactChanges(tool!.id, (change) => heard.push(change));
    await data({ tool: "lessons", action: "set", collection: "c", doc_id: "a", data: { n: 1 } });
    await data({ tool: "lessons", action: "batch", writes: [{ op: "set", collection: "c", doc_id: "b", data: { n: 2 } }, { op: "delete", collection: "c", doc_id: "a" }] });
    await data({ tool: "lessons", action: "delete", collection: "c", doc_id: "never-there" });
    off();
    expect(heard).toMatchObject([
      { by: "agent", docs: [{ collection: "c", docId: "a", data: { n: 1 }, updatedBy: "agent" }], deleted: [] },
      { by: "agent", docs: [{ collection: "c", docId: "b", data: { n: 2 } }], deleted: [{ collection: "c", docId: "a" }] },
    ]);
  });
});
