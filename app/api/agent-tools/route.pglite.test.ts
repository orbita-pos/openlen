// @vitest-environment node
//
// GET /api/agent-tools?assistantId= (spec local 2026-11-22-herramienta-dentro-del-agente, §2): the tools an agent has made for its
// person, which are the tabs of its place on the web and the buttons of its chat on the phone. Against the real store (PGlite)
// with the tables as `npm run assistants:migrate` creates them.
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
const store = await import("@/lib/agent-tools/store");
const route = await import("./route");

let pg: PGlite;

function toolInput(o: { id: string; assistantId?: string; personId?: string; slug?: string; title?: string; releaseSha?: string }) {
  return {
    id: o.id,
    assistantId: o.assistantId ?? "teacher",
    personId: o.personId ?? "u1",
    spaceProjectId: "space",
    slug: o.slug ?? "lessons",
    title: o.title ?? "Lessons",
    folder: `/tools/${o.assistantId ?? "teacher"}/${o.slug ?? "lessons"}`,
    releaseSha: o.releaseSha ?? "sha-1",
    hostLabel: `lienzo-host-${o.id}`,
    phoneHostLabel: `lienzo-phone-${o.id}`,
  };
}

const get = (query = "assistantId=teacher", headers: Record<string, string> = {}) =>
  route.GET(new Request(`https://openlen.com/api/agent-tools${query ? `?${query}` : ""}`, { headers }));
const call = async (query?: string) => {
  const res = await get(query);
  return { status: res.status, body: (await res.json()) as unknown };
};

beforeAll(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  for (const [id, person, project] of [["teacher", "u1", "space"], ["finance", "u1", "space"], ["stranger", "u2", "other-space"]]) {
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
  await pg.query(`delete from "agentTools"`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the list of an agent's tools", () => {
  it("is the id, the folder name, the title and where to frame it, for each tool, oldest first so the tabs stay put", async () => {
    // Made in the order b, a, c — the ids and names are not in that order.
    await store.upsertAgentTool(toolInput({ id: "tool-b", slug: "budget", title: "Budget" }));
    await store.upsertAgentTool(toolInput({ id: "tool-a", slug: "lessons", title: "Lessons", releaseSha: "sha-9" }));
    await store.upsertAgentTool(toolInput({ id: "tool-c", slug: "plan", title: "Plan" }));
    for (const [id, at] of [["tool-b", "2026-11-22T10:00:00Z"], ["tool-a", "2026-11-22T11:00:00Z"], ["tool-c", "2026-11-22T12:00:00Z"]]) {
      await pg.query(`update "agentTools" set "createdAt" = $2 where "id" = $1`, [id, at]);
    }
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      { id: "tool-b", slug: "budget", title: "Budget", frameUrl: "http://lienzo-host-tool-b.localhost/?v=sha-1", frameOrigin: "http://lienzo-host-tool-b.localhost" },
      { id: "tool-a", slug: "lessons", title: "Lessons", frameUrl: "http://lienzo-host-tool-a.localhost/?v=sha-9", frameOrigin: "http://lienzo-host-tool-a.localhost" },
      { id: "tool-c", slug: "plan", title: "Plan", frameUrl: "http://lienzo-host-tool-c.localhost/?v=sha-1", frameOrigin: "http://lienzo-host-tool-c.localhost" },
    ]);
  });

  it("frames on the host the request came to: the dev server's port is kept", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-a" }));
    const res = await get("assistantId=teacher", { host: "localhost:3000" });
    expect(await res.json()).toEqual([expect.objectContaining({ frameUrl: "http://lienzo-host-tool-a.localhost:3000/?v=sha-1", frameOrigin: "http://lienzo-host-tool-a.localhost:3000" })]);
  });

  it("gives the WORKSPACE's address, never the phone's: the phone asks to open it and is given its own", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-a" }));
    const [tool] = (await call()).body as { frameUrl: string }[];
    expect(tool!.frameUrl).toContain("lienzo-host-tool-a");
    expect(JSON.stringify(tool)).not.toContain("lienzo-phone");
  });

  it("an agent without tools has an empty list", async () => {
    expect(await call()).toEqual({ status: 200, body: [] });
  });

  it("only this agent's tools: not another agent's of the same person", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-a" }));
    await store.upsertAgentTool(toolInput({ id: "tool-f", assistantId: "finance", slug: "budget", title: "Budget" }));
    expect(((await call("assistantId=teacher")).body as { id: string }[]).map((t) => t.id)).toEqual(["tool-a"]);
    expect(((await call("assistantId=finance")).body as { id: string }[]).map((t) => t.id)).toEqual(["tool-f"]);
  });

  it("a tool with no frame address here (the canvas origin is switched off) is left out", async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-a" }));
    vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "0");
    expect(await call()).toEqual({ status: 200, body: [] });
  });

  it("answers JSON that is never cached", async () => {
    const res = await get();
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("🔴 who may", () => {
  beforeEach(async () => {
    await store.upsertAgentTool(toolInput({ id: "tool-a" }));
    await store.upsertAgentTool(toolInput({ id: "tool-x", assistantId: "stranger", personId: "u2", slug: "theirs" }));
  });

  it("another person's agent gets the same 404 as an agent that doesn't exist", async () => {
    const missing = await call("assistantId=no-such-agent");
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await call("assistantId=stranger")).toEqual(missing);
    base.person = "u2";
    expect(await call("assistantId=teacher")).toEqual(missing);
  });

  it("their own agent's tools still come for them", async () => {
    base.person = "u2";
    expect(((await call("assistantId=stranger")).body as { id: string }[]).map((t) => t.id)).toEqual(["tool-x"]);
  });

  it("nobody signed in, no key: the same 404", async () => {
    base.person = null;
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("a request that names no agent is a 400, after the person is known", async () => {
    const r = await call("");
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "bad_request", message: "assistantId is required." });
    expect((await call("assistantId=")).status).toBe(400);
    base.person = null;
    expect((await call("")).status).toBe(404);
  });

  it("with the tools switched off the list is empty, so the screens simply have no tabs", async () => {
    vi.stubEnv("OPENLEN_AGENT_TOOLS", "0");
    expect(await call()).toEqual({ status: 200, body: [] });
    // and it says nothing about whose agent is whose
    expect(await call("assistantId=stranger")).toEqual({ status: 200, body: [] });
  });

  it("there is no plan check on this path: free or paid, it lists", async () => {
    // The route runs here with no credits or plan tables (its `users` table has no plan column): reaching for a plan would throw.
    expect((await call()).status).toBe(200);
  });
});

describe("for the phone's app", () => {
  it("answers the app's origin with CORS, and the preflight too", async () => {
    const res = await get("assistantId=teacher", { origin: "https://localhost", authorization: "Bearer a-phone-key" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const pre = route.OPTIONS(new Request("https://openlen.com/api/agent-tools", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("another origin gets none", async () => {
    expect((await get("assistantId=teacher", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
  });
});
