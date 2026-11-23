// @vitest-environment node
//
// DELETE /api/agent-tools/[id] (spec local 2026-11-22-herramienta-dentro-del-agente, §1): taking a tool away is the PERSON's —
// from the menu of its tab on the web, or from the phone — and it deletes the tool and its data for good; every screen following
// it is told `gone`. The agent has no way to do it. Against the real store (PGlite) with the tables as `npm run
// assistants:migrate` creates them.
import fs from "node:fs";
import path from "node:path";

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
const { subscribeToolChanges } = await import("@/lib/agent-tools/bus");
const store = await import("@/lib/agent-tools/store");
const route = await import("./route");
const followRoute = await import("./follow/route");

let pg: PGlite;
let unsubscribe: (() => void)[] = [];
const gone: string[] = [];
const changes: unknown[] = [];

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

const del = (id = "tool-1", headers: Record<string, string> = {}) =>
  route.DELETE(new Request(`https://openlen.com/api/agent-tools/${id}`, { method: "DELETE", headers }), { params: Promise.resolve({ id }) });
const call = async (id = "tool-1") => {
  const res = await del(id);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const countRows = async (table: string, toolColumn: string, toolId: string) =>
  Number((await pg.query<{ n: string }>(`select count(*) as n from "${table}" where "${toolColumn}" = $1`, [toolId])).rows[0]!.n);

const set = (collection: string, docId: string, data: Record<string, unknown>) => ({ op: "set" as const, collection, docId, data });

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
  gone.length = 0;
  changes.length = 0;
  await pg.query(`delete from "agentTools"`);
  await store.upsertAgentTool(toolInput({ id: "tool-1" }));
  await store.upsertAgentTool(toolInput({ id: "tool-2", slug: "plan" }));
  await store.upsertAgentTool(toolInput({ id: "tool-x", assistantId: "stranger", personId: "u2", slug: "theirs" }));
  for (const id of ["tool-1", "tool-2", "tool-x"]) await store.writeDocs(id, [set("c", "a", { from: id })], "agent");
  unsubscribe = ["tool-1", "tool-2", "tool-x"].map((id) =>
    subscribeToolChanges(
      id,
      (change) => changes.push(change),
      () => gone.push(id),
    ),
  );
});

afterEach(() => {
  for (const off of unsubscribe) off();
  vi.unstubAllEnvs();
});

describe("the person deletes a tool", () => {
  it("answers 200 and the tool and its data are gone for good", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(await store.agentToolById("tool-1")).toBeNull();
    expect(await store.readDocs("tool-1")).toEqual([]);
    expect(await countRows("agentToolDocs", "toolId", "tool-1")).toBe(0);
  });

  it("🔴 and no other tool: not the same agent's other one, not another person's", async () => {
    await call();
    expect(await store.agentToolById("tool-2")).not.toBeNull();
    expect(await store.readDocs("tool-2")).toHaveLength(1);
    expect(await store.agentToolById("tool-x")).not.toBeNull();
    expect(await store.readDocs("tool-x")).toHaveLength(1);
  });

  it("every screen following it is told it is gone (and no one following another tool)", async () => {
    await call();
    expect(gone).toEqual(["tool-1"]);
    expect(changes).toEqual([]);
  });

  it("🔴 a stream open on it gets `gone` and ends, end to end", async () => {
    const controller = new AbortController();
    const res = await followRoute.GET(new Request("https://openlen.com/api/agent-tools/tool-1/follow", { signal: controller.signal }), { params: Promise.resolve({ id: "tool-1" }) });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    const readUntil = async (done: () => boolean) => {
      while (!done()) {
        const chunk = await reader.read();
        if (chunk.done) return;
        raw += decoder.decode(chunk.value, { stream: true });
      }
    };
    await readUntil(() => raw.includes("event: baseline"));
    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    await readUntil(() => false); // to the end
    expect(raw.endsWith("event: gone\ndata: {}\n\n")).toBe(true);
    controller.abort();
  });

  it("the folder's files stay: only the row and its data go — the agent and the space they were made in are untouched", async () => {
    // The route never reaches for the space's files, so there is nothing of theirs it could remove.
    const src = fs.readFileSync(path.join(process.cwd(), "app/api/agent-tools/[id]/route.ts"), "utf8");
    expect(src).not.toMatch(/projectFiles|deleteFile|removeFile|lib\/files|lib\/projects/);
    await call();
    expect((await pg.query(`select 1 from "assistants" where "id" = 'teacher'`)).rows).toHaveLength(1);
    expect((await pg.query(`select 1 from "projects" where "id" = 'space'`)).rows).toHaveLength(1);
  });

  it("a second delete, once it is gone, is the same 404 as a tool that never was — and tells no one again", async () => {
    await call();
    gone.length = 0;
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
    expect(gone).toEqual([]);
  });

  it("answers JSON that is never cached", async () => {
    const res = await del();
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("🔴 who may", () => {
  it("another person gets the same 404 as a tool that doesn't exist, and nothing is deleted or told", async () => {
    base.person = "u2";
    const missing = await call("no-such-tool");
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await call("tool-1")).toEqual(missing);
    expect(await store.agentToolById("tool-1")).not.toBeNull();
    expect(await store.readDocs("tool-1")).toHaveLength(1);
    expect(gone).toEqual([]);
  });

  it("their own tool still goes for them", async () => {
    base.person = "u2";
    expect(await call("tool-x")).toEqual({ status: 200, body: { ok: true } });
    expect(await store.agentToolById("tool-x")).toBeNull();
    expect(gone).toEqual(["tool-x"]);
  });

  it("nobody signed in, no key: the same 404, and nothing is deleted", async () => {
    base.person = null;
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await store.agentToolById("tool-1")).not.toBeNull();
    expect(gone).toEqual([]);
  });

  it("with the tools switched off: the same 404, and nothing is deleted", async () => {
    vi.stubEnv("OPENLEN_AGENT_TOOLS", "0");
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await store.agentToolById("tool-1")).not.toBeNull();
    expect(gone).toEqual([]);
  });

  it("there is no plan check on this path: free or paid, it deletes", async () => {
    // The route runs here with no `users`/`credits` tables at all: reaching for either would throw.
    expect((await call()).status).toBe(200);
  });

  it("🔴 the agent has no way to delete a tool: nothing the agent runs reaches `deleteAgentTool`", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && fs.readFileSync(path.join(process.cwd(), rel), "utf8").includes("deleteAgentTool")) callers.push(rel);
      }
    };
    for (const dir of ["lib", "app"]) walk(dir);
    expect(callers.sort()).toEqual(["app/api/agent-tools/[id]/route.ts", "lib/agent-tools/store.ts"]);
  });
});

describe("for the phone's app", () => {
  it("the phone deletes with its key, answers the app's origin with CORS, and the preflight too", async () => {
    const res = await del("tool-1", { origin: "https://localhost", authorization: "Bearer a-phone-key" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const pre = route.OPTIONS(new Request("https://openlen.com/api/agent-tools/tool-1", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(pre.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("another origin gets none", async () => {
    expect((await del("tool-1", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
  });
});
