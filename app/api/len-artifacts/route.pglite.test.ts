// @vitest-environment node
//
// GET /api/len-artifacts?projectId= | ?assistantId= (spec local 2026-11-22-artifacts-de-len, §2, §4): Len's artifacts in a
// project — the lenses of its canvas — or the ones an agent made — the tabs of its place on the web and the buttons of its
// chat on the phone. Against the real store (PGlite) with the tables as `npm run assistants:migrate` creates them.
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
const store = await import("@/lib/len-artifacts/store");
const route = await import("./route");

let pg: PGlite;

/** An artifact: by default the `teacher` agent's in u1's space; `assistantId: null` is Len's, by default in u1's `site`. */
function toolInput(o: { id: string; assistantId?: string | null; personId?: string; projectId?: string; slug?: string; title?: string; releaseSha?: string }) {
  const assistantId = o.assistantId === undefined ? "teacher" : o.assistantId;
  const slug = o.slug ?? "lessons";
  return {
    id: o.id,
    projectId: o.projectId ?? (assistantId === null ? "site" : assistantId === "stranger" ? "other-space" : "space"),
    personId: o.personId ?? (assistantId === "stranger" ? "u2" : "u1"),
    assistantId,
    slug,
    title: o.title ?? "Lessons",
    folder: assistantId === null ? `/.artifacts/${slug}` : `/.artifacts/${assistantId}/${slug}`,
    releaseSha: o.releaseSha ?? "sha-1",
    hostLabel: `lienzo-host-${o.id}`,
    phoneHostLabel: `lienzo-phone-${o.id}`,
  };
}

const get = (query = "assistantId=teacher", headers: Record<string, string> = {}) =>
  route.GET(new Request(`https://openlen.com/api/len-artifacts${query ? `?${query}` : ""}`, { headers }));
const call = async (query?: string) => {
  const res = await get(query);
  return { status: res.status, body: (await res.json()) as unknown };
};

beforeAll(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  // u3 is a member of u1's `site` (invited to it), never its owner.
  await pg.query(`insert into "users" values ('u1'), ('u2'), ('u3')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2'), ('site', 'u1'), ('site-2', 'u1')`);
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
  await pg.query(`delete from "lenArtifacts"`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the list of an agent's tools", () => {
  it("is the id, the folder name, the title, the version and where to frame it, for each tool, oldest first so the tabs stay put", async () => {
    // Made in the order b, a, c — the ids and names are not in that order.
    await store.upsertLenArtifact(toolInput({ id: "tool-b", slug: "budget", title: "Budget" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-a", slug: "lessons", title: "Lessons", releaseSha: "sha-9" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-c", slug: "plan", title: "Plan" }));
    for (const [id, at] of [["tool-b", "2026-11-22T10:00:00Z"], ["tool-a", "2026-11-22T11:00:00Z"], ["tool-c", "2026-11-22T12:00:00Z"]]) {
      await pg.query(`update "lenArtifacts" set "createdAt" = $2 where "id" = $1`, [id, at]);
    }
    const r = await call();
    expect(r.status).toBe(200);
    await pg.query(`update "lenArtifacts" set "updatedAt" = '2026-11-22T13:00:00Z'`);
    expect(r.body).toEqual([
      { id: "tool-b", slug: "budget", title: "Budget", releaseSha: "sha-1", updatedAt: expect.any(String), frameUrl: "http://lienzo-host-tool-b.localhost/?v=sha-1", frameOrigin: "http://lienzo-host-tool-b.localhost" },
      { id: "tool-a", slug: "lessons", title: "Lessons", releaseSha: "sha-9", updatedAt: expect.any(String), frameUrl: "http://lienzo-host-tool-a.localhost/?v=sha-9", frameOrigin: "http://lienzo-host-tool-a.localhost" },
      { id: "tool-c", slug: "plan", title: "Plan", releaseSha: "sha-1", updatedAt: expect.any(String), frameUrl: "http://lienzo-host-tool-c.localhost/?v=sha-1", frameOrigin: "http://lienzo-host-tool-c.localhost" },
    ]);
    // When it was last published, as an ISO date.
    expect(((await call()).body as { updatedAt: string }[])[0]!.updatedAt).toBe("2026-11-22T13:00:00.000Z");
  });

  it("frames on the host the request came to: the dev server's port is kept", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-a" }));
    const res = await get("assistantId=teacher", { host: "localhost:3000" });
    expect(await res.json()).toEqual([expect.objectContaining({ frameUrl: "http://lienzo-host-tool-a.localhost:3000/?v=sha-1", frameOrigin: "http://lienzo-host-tool-a.localhost:3000" })]);
  });

  it("gives the WORKSPACE's address, never the phone's: the phone asks to open it and is given its own", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-a" }));
    const [tool] = (await call()).body as { frameUrl: string }[];
    expect(tool!.frameUrl).toContain("lienzo-host-tool-a");
    expect(JSON.stringify(tool)).not.toContain("lienzo-phone");
  });

  it("an agent without tools has an empty list", async () => {
    expect(await call()).toEqual({ status: 200, body: [] });
  });

  it("an agent's artifacts in every project it made them in, and never Len's", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-a" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-s", projectId: "site", slug: "in-site" }));
    await store.upsertLenArtifact(toolInput({ id: "len-1", assistantId: null, slug: "board" }));
    expect(((await call("assistantId=teacher")).body as { id: string }[]).map((t) => t.id)).toEqual(["tool-a", "tool-s"]);
  });

  it("only this agent's tools: not another agent's of the same person", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-a" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-f", assistantId: "finance", slug: "budget", title: "Budget" }));
    expect(((await call("assistantId=teacher")).body as { id: string }[]).map((t) => t.id)).toEqual(["tool-a"]);
    expect(((await call("assistantId=finance")).body as { id: string }[]).map((t) => t.id)).toEqual(["tool-f"]);
  });

  it("a tool with no frame address here (the canvas origin is switched off) is left out", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-a" }));
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
    await store.upsertLenArtifact(toolInput({ id: "tool-a" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-x", assistantId: "stranger", personId: "u2", slug: "theirs" }));
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

  it("a tool on the person's own agent whose row names another person is not listed (its follow, open and delete would 404)", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-odd", personId: "u2", slug: "odd" }));
    const ids = ((await call()).body as { id: string }[]).map((t) => t.id);
    expect(ids).toContain("tool-a");
    expect(ids).not.toContain("tool-odd");
  });

  it("nobody signed in, no key: the same 404", async () => {
    base.person = null;
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("a request that names neither a project nor an agent, or both, is a 400, after the person is known", async () => {
    const r = await call("");
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "bad_request", message: "Name one: projectId (Len's artifacts in that project) or assistantId (that agent's)." });
    expect((await call("assistantId=")).status).toBe(400);
    expect((await call("projectId=")).status).toBe(400);
    expect((await call("projectId=site&assistantId=teacher")).status).toBe(400);
    base.person = null;
    expect((await call("")).status).toBe(404);
  });

  it("with the tools switched off the list is empty, so the screens simply have no tabs", async () => {
    vi.stubEnv("OPENLEN_LEN_ARTIFACTS", "0");
    expect(await call()).toEqual({ status: 200, body: [] });
    // and it says nothing about whose agent is whose
    expect(await call("assistantId=stranger")).toEqual({ status: 200, body: [] });
  });

  it("there is no plan check on this path: free or paid, it lists", async () => {
    // The route runs here with no credits or plan tables (its `users` table has no plan column): reaching for a plan would throw.
    expect((await call()).status).toBe(200);
  });
});

describe("Len's artifacts in a project (?projectId=)", () => {
  beforeEach(async () => {
    await store.upsertLenArtifact(toolInput({ id: "len-b", assistantId: null, slug: "board", title: "Board" }));
    await store.upsertLenArtifact(toolInput({ id: "len-p", assistantId: null, slug: "plan", title: "Plan" }));
    // An agent's in the same project, and Len's in another project of the same person: neither is this list.
    await store.upsertLenArtifact(toolInput({ id: "tool-s", projectId: "site", slug: "in-site" }));
    await store.upsertLenArtifact(toolInput({ id: "len-other", assistantId: null, projectId: "site-2", slug: "board" }));
    for (const [id, at] of [["len-b", "2026-11-22T10:00:00Z"], ["len-p", "2026-11-22T11:00:00Z"]]) {
      await pg.query(`update "lenArtifacts" set "createdAt" = $2 where "id" = $1`, [id, at]);
    }
  });

  it("lists Len's artifacts of that project only, oldest first, as the lenses of its canvas", async () => {
    const r = await call("projectId=site");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      expect.objectContaining({ id: "len-b", slug: "board", title: "Board", releaseSha: "sha-1", frameUrl: "http://lienzo-host-len-b.localhost/?v=sha-1" }),
      expect.objectContaining({ id: "len-p", slug: "plan", title: "Plan" }),
    ]);
    expect(((await call("projectId=site-2")).body as { id: string }[]).map((t) => t.id)).toEqual(["len-other"]);
  });

  it("a project without artifacts has an empty list", async () => {
    await pg.query(`delete from "lenArtifacts" where "projectId" = 'site'`);
    expect(await call("projectId=site")).toEqual({ status: 200, body: [] });
  });

  it("🔴 a member of the project, another person's project, a project that doesn't exist, nobody signed in: one 404", async () => {
    const missing = await call("projectId=no-such-project");
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });
    base.person = "u3";
    expect(await call("projectId=site")).toEqual(missing);
    base.person = "u2";
    expect(await call("projectId=site")).toEqual(missing);
    base.person = null;
    expect(await call("projectId=site")).toEqual(missing);
  });

  it("an artifact whose row names another person is not listed (its follow, open and delete would 404)", async () => {
    await store.upsertLenArtifact(toolInput({ id: "len-odd", assistantId: null, personId: "u2", slug: "odd" }));
    expect(((await call("projectId=site")).body as { id: string }[]).map((t) => t.id)).not.toContain("len-odd");
  });

  it("with the artifacts switched off the list is empty, and says nothing about whose project is whose", async () => {
    vi.stubEnv("OPENLEN_LEN_ARTIFACTS", "0");
    expect(await call("projectId=site")).toEqual({ status: 200, body: [] });
    base.person = "u2";
    expect(await call("projectId=site")).toEqual({ status: 200, body: [] });
  });
});

describe("for the phone's app", () => {
  it("answers the app's origin with CORS, and the preflight too", async () => {
    const res = await get("assistantId=teacher", { origin: "https://localhost", authorization: "Bearer a-phone-key" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const pre = route.OPTIONS(new Request("https://openlen.com/api/len-artifacts", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("another origin gets none", async () => {
    expect((await get("assistantId=teacher", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
  });
});
