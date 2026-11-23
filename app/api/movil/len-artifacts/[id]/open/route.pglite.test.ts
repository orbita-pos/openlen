// @vitest-environment node
//
// POST /api/movil/len-artifacts/[id]/open (spec local 2026-11-22-artifacts-de-len, §2–§3): the phone app opens one of its
// person's agent tools full screen — its frame URL on the phone's OWN private label, which only the phone app may frame, stored
// with the tool when it was published (it is never set here). Against the real store (PGlite) with the tables as `npm run
// assistants:migrate` creates them.
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

function toolInput(o: { id: string; assistantId?: string; personId?: string; slug?: string; phoneHostLabel?: string | null }) {
  return {
    id: o.id,
    assistantId: o.assistantId ?? "teacher",
    personId: o.personId ?? "u1",
    projectId: "space",
    slug: o.slug ?? "lessons",
    title: "Lessons",
    folder: `/.artifacts/${o.assistantId ?? "teacher"}/${o.slug ?? "lessons"}`,
    releaseSha: "sha-1",
    hostLabel: `lienzo-host-${o.id}`,
    phoneHostLabel: o.phoneHostLabel === undefined ? `lienzo-phone-${o.id}` : o.phoneHostLabel,
  };
}

const post = (id = "tool-1", headers: Record<string, string> = {}) =>
  route.POST(new Request(`https://openlen.com/api/movil/len-artifacts/${id}/open`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
const call = async (id = "tool-1") => {
  const res = await post(id);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const labels = async (id = "tool-1") => (await pg.query<{ h: string; p: string | null }>(`select "hostLabel" as h, "phoneHostLabel" as p from "lenArtifacts" where "id" = $1`, [id])).rows[0]!;

beforeAll(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  // u3 is a MEMBER of u1's `site` (invited to it), never its owner.
  await pg.query(`insert into "users" values ('u1'), ('u2'), ('u3')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2'), ('site', 'u1')`);
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
  await pg.query(`delete from "lenArtifacts"`);
  await store.upsertLenArtifact(toolInput({ id: "tool-1" }));
  await store.upsertLenArtifact(toolInput({ id: "tool-x", assistantId: "stranger", personId: "u2", slug: "theirs" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("opening a tool on the phone", () => {
  it("gives its frame URL on the PHONE's label, with the published version, and the origin that frames it", async () => {
    expect(await call()).toEqual({
      status: 200,
      body: { url: "http://lienzo-phone-tool-1.localhost/?v=sha-1", origin: "http://lienzo-phone-tool-1.localhost" },
    });
  });

  it("🔴 never the workspace's label: that one is framed only by openlen.com", async () => {
    const r = await call();
    expect(JSON.stringify(r.body)).not.toContain("lienzo-host");
  });

  it("frames on the host the request came to: the dev server's port is kept", async () => {
    const res = await post("tool-1", { host: "localhost:3000" });
    expect(await res.json()).toEqual({ url: "http://lienzo-phone-tool-1.localhost:3000/?v=sha-1", origin: "http://lienzo-phone-tool-1.localhost:3000" });
  });

  it("a republished tool is opened on the new version, on the same address", async () => {
    await store.upsertLenArtifact({ ...toolInput({ id: "another-id" }), releaseSha: "sha-2" });
    expect(await call()).toEqual({ status: 200, body: { url: "http://lienzo-phone-tool-1.localhost/?v=sha-2", origin: "http://lienzo-phone-tool-1.localhost" } });
  });

  it("the label is the one stored once, when the tool was published: opening never writes it", async () => {
    const before = await labels();
    await call();
    await call();
    expect(await labels()).toEqual(before);
  });

  it("a tool with no phone label stored is a 503 no_frame_host, and none is made up", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-9", slug: "nine", phoneHostLabel: null }));
    expect(await call("tool-9")).toEqual({ status: 503, body: { error: "no_frame_host" } });
    expect((await labels("tool-9")).p).toBeNull();
  });

  it("with the canvas origin switched off there is no frame to open: 503 no_frame_host", async () => {
    vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "0");
    expect(await call()).toEqual({ status: 503, body: { error: "no_frame_host" } });
  });

  it("answers JSON that is never cached", async () => {
    const res = await post();
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("🔴 who may", () => {
  it("🔴 a member of the project gets the same 404 as an artifact that doesn't exist", async () => {
    await store.upsertLenArtifact({
      id: "len-1",
      projectId: "site",
      personId: "u1",
      assistantId: null,
      slug: "board",
      title: "Board",
      folder: "/.artifacts/board",
      releaseSha: "sha-1",
      hostLabel: "lienzo-host-len-1",
      phoneHostLabel: "lienzo-phone-len-1",
    });
    base.person = "u3";
    const missing = await call("no-such-tool");
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await call("len-1")).toEqual(missing);
    // Even for the owner, Len's project artifacts do not open on the phone in this round (spec §4 / "Lo que no").
    base.person = "u1";
    expect(await call("len-1")).toEqual(missing);
  });

  it("another person gets the same 404 as a tool that doesn't exist", async () => {
    base.person = "u2";
    const missing = await call("no-such-tool");
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await call("tool-1")).toEqual(missing);
  });

  it("their own tool still opens for them", async () => {
    base.person = "u2";
    expect((await call("tool-x")).status).toBe(200);
  });

  it("nobody signed in, no key: the same 404", async () => {
    base.person = null;
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("with the tools switched off: the same 404", async () => {
    vi.stubEnv("OPENLEN_LEN_ARTIFACTS", "0");
    expect(await call()).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("there is no plan check on this path: free or paid, it opens", async () => {
    // The route runs here with no credits or plan tables (its `users` table has no plan column): reaching for a plan would throw.
    expect((await call()).status).toBe(200);
  });
});

describe("for the phone's app", () => {
  it("answers the app's origin with CORS, and the preflight too", async () => {
    const res = await post("tool-1", { origin: "https://localhost", authorization: "Bearer a-phone-key" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const pre = route.OPTIONS(new Request("https://openlen.com/api/movil/len-artifacts/tool-1/open", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("another origin gets none", async () => {
    expect((await post("tool-1", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
  });
});
