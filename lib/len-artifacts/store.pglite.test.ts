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
const { CREATE_TOOLS } = await import("@/scripts/tools-migrate-sql");
const { LEN_ARTIFACT_DATA_MAX_BYTES, LEN_ARTIFACT_DOC_MAX_BYTES, LEN_ARTIFACT_DOCS_MAX } = await import("./limits");
const store = await import("./store");
const toolStore = await import("@/lib/tools/store");

let pg: PGlite;

/** An artifact: by default the `teacher` agent's in the person's space; `assistantId: null` is Len's, by default in the
 *  project `site`. Its labels derive from the id here (the real ones are HMACs). */
function toolInput(
  o: {
    id?: string;
    projectId?: string;
    personId?: string;
    assistantId?: string | null;
    slug?: string;
    title?: string;
    folder?: string;
    releaseSha?: string;
    hostLabel?: string;
    phoneHostLabel?: string | null;
  } = {},
) {
  const id = o.id ?? "tool-1";
  const assistantId = o.assistantId === undefined ? "teacher" : o.assistantId;
  const slug = o.slug ?? "lessons";
  return {
    id,
    projectId: o.projectId ?? (assistantId === null ? "site" : "space"),
    personId: o.personId ?? "u1",
    assistantId,
    slug,
    title: o.title ?? "Lessons",
    folder: o.folder ?? (assistantId === null ? `/.artifacts/${slug}` : `/.artifacts/${assistantId}/${slug}`),
    releaseSha: o.releaseSha ?? "sha-1",
    hostLabel: o.hostLabel ?? `lienzo-host-${id}`,
    ...(o.phoneHostLabel === undefined ? { phoneHostLabel: `lienzo-phone-${id}` } : { phoneHostLabel: o.phoneHostLabel }),
  };
}

const LEN = "len" as const;
const teacher = { assistantId: "teacher" };
const slugsOf = (rows: readonly { slug: string }[]) => rows.map((r) => r.slug);

const set = (collection: string, docId: string, data: Record<string, unknown>) => ({ op: "set" as const, collection, docId, data });
const update = (collection: string, docId: string, data: Record<string, unknown>) => ({ op: "update" as const, collection, docId, data });
const del = (collection: string, docId: string) => ({ op: "delete" as const, collection, docId });

/** Document with a JSON of exactly `bytes` bytes. */
const docOfBytes = (bytes: number): Record<string, unknown> => ({ t: "x".repeat(bytes - JSON.stringify({ t: "" }).length) });
const countDocs = async (toolId = "tool-1") => Number((await pg.query<{ n: string }>(`select count(*) as n from "lenArtifactDocs" where "toolId" = $1`, [toolId])).rows[0]!.n);

async function dataChangedAt(toolId = "tool-1") {
  return (await pg.query<{ d: Date | null }>(`select "dataChangedAt" as d from "lenArtifacts" where "id" = $1`, [toolId])).rows[0]!.d;
}

/** Fills the tool with `n` documents of `bytes` bytes straight into the table (fast), the way earlier writes would have. */
async function seed(n: number, bytes: number, toolId = "tool-1", collection = "seed") {
  await pg.query(
    `insert into "lenArtifactDocs" ("toolId", "collection", "docId", "data", "bytes", "updatedBy")
     select $1, $2, 'd' || g, '{}'::jsonb, $3, 'agent' from generate_series(1, $4) g`,
    [toolId, collection, bytes, n],
  );
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2'), ('site', 'u1'), ('site-2', 'u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  for (const statement of CREATE_TOOLS) await pg.query(statement);
  for (const [id, person, project, slug] of [["teacher", "u1", "space", "teacher"], ["finance", "u1", "space", "finance"], ["stranger", "u2", "other-space", "stranger"]]) {
    await pg.query(
      `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ($1, $2, $1, $3, 'drop', '#19c3b1', 'friendly', $4)`,
      [id, person, slug, project],
    );
  }
  base.db = drizzle(pg, { schema });
  await store.upsertLenArtifact(toolInput());
});

describe("the artifact rows", () => {
  it("keeps an artifact and finds it by id, and by its project and maker, in the order it was made", async () => {
    const row = await store.lenArtifactById("tool-1");
    expect(row).toMatchObject({
      id: "tool-1",
      projectId: "space",
      personId: "u1",
      assistantId: "teacher",
      slug: "lessons",
      title: "Lessons",
      folder: "/.artifacts/teacher/lessons",
      releaseSha: "sha-1",
      dataChangedAt: null,
      makerSeenAt: null,
    });
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(await store.lenArtifactById("nope")).toBeNull();

    await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan", title: "Plan" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-3", assistantId: "finance", slug: "budget", title: "Budget" }));
    await store.upsertLenArtifact(toolInput({ id: "len-1", assistantId: null, slug: "board", title: "Board" }));
    expect(slugsOf(await store.lenArtifactsOf({ projectId: "space", maker: teacher }))).toEqual(["lessons", "plan"]);
    expect(slugsOf(await store.lenArtifactsOf({ projectId: "space", maker: { assistantId: "finance" } }))).toEqual(["budget"]);
    expect(slugsOf(await store.lenArtifactsOf({ projectId: "site", maker: LEN }))).toEqual(["board"]);
    // Len's are not an agent's, and an agent's are not Len's.
    expect(await store.lenArtifactsOf({ projectId: "space", maker: LEN })).toEqual([]);
    expect(await store.lenArtifactsOf({ projectId: "site", maker: teacher })).toEqual([]);
    // An agent's in every project it made them in.
    expect(slugsOf(await store.lenArtifactsOf({ maker: teacher }))).toEqual(["lessons", "plan"]);
    expect(await store.lenArtifactsOf({ maker: { assistantId: "stranger" } })).toEqual([]);
  });

  it("finds an artifact by its project and folder", async () => {
    await store.upsertLenArtifact(toolInput({ id: "len-1", assistantId: null, slug: "board" }));
    expect(await store.lenArtifactByFolder("site", "/.artifacts/board")).toMatchObject({ id: "len-1", assistantId: null });
    expect(await store.lenArtifactByFolder("space", "/.artifacts/teacher/lessons")).toMatchObject({ id: "tool-1" });
    expect(await store.lenArtifactByFolder("site-2", "/.artifacts/board")).toBeNull();
    expect(await store.lenArtifactByFolder("site", "/.artifacts/nope")).toBeNull();
  });

  it("🔴 publishing again keeps the artifact (its id, its address, its data) and moves the version", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { n: 1 })], "agent");
    const again = await store.upsertLenArtifact(toolInput({ id: "another-id", title: "Lessons 2", releaseSha: "sha-2", hostLabel: "lienzo-other" }));
    expect(again).toMatchObject({ id: "tool-1", slug: "lessons", title: "Lessons 2", releaseSha: "sha-2", hostLabel: "lienzo-host-tool-1" });
    expect(again.phoneHostLabel).toBe("lienzo-phone-tool-1");
    expect(again.updatedAt.getTime()).toBeGreaterThanOrEqual(again.createdAt.getTime());
    expect(await store.lenArtifactsOf({ projectId: "space", maker: teacher })).toHaveLength(1);
    expect(await store.readDocs("tool-1")).toHaveLength(1);
  });

  it("the folder in its project is the identity: the same folder in another project is another artifact", async () => {
    await store.upsertLenArtifact(toolInput({ id: "len-a", assistantId: null, slug: "board" }));
    await store.upsertLenArtifact(toolInput({ id: "len-b", assistantId: null, projectId: "site-2", slug: "board" }));
    expect((await store.lenArtifactsOf({ projectId: "site", maker: LEN })).map((t) => t.id)).toEqual(["len-a"]);
    expect((await store.lenArtifactsOf({ projectId: "site-2", maker: LEN })).map((t) => t.id)).toEqual(["len-b"]);
  });

  it("🔴 nobody publishes over another maker's artifact: its folder in that project stays its maker's, and nothing changes", async () => {
    const intruder = { ...toolInput({ id: "len-x", assistantId: null, projectId: "space", releaseSha: "sha-evil" }), folder: "/.artifacts/teacher/lessons" };
    await expect(store.upsertLenArtifact(intruder)).rejects.toBeInstanceOf(store.LenArtifactMakerError);
    await expect(store.upsertLenArtifact(intruder, { maxPerMaker: 5 })).rejects.toBeInstanceOf(store.LenArtifactMakerError);
    const finance = { ...toolInput({ id: "fin-x", assistantId: "finance", releaseSha: "sha-evil" }), folder: "/.artifacts/teacher/lessons" };
    await expect(store.upsertLenArtifact(finance, { maxPerMaker: 5 })).rejects.toBeInstanceOf(store.LenArtifactMakerError);
    expect(await store.lenArtifactById("tool-1")).toMatchObject({ assistantId: "teacher", releaseSha: "sha-1", title: "Lessons" });
    expect(await store.lenArtifactById("len-x")).toBeNull();
    expect(await store.lenArtifactById("fin-x")).toBeNull();
  });

  it("finds an artifact by the label of the workspace or of the phone, and says which one was asked", async () => {
    expect(await store.lenArtifactByLabel("lienzo-host-tool-1")).toMatchObject({ id: "tool-1", servedTo: "workspace" });
    expect(await store.lenArtifactByLabel("lienzo-phone-tool-1")).toMatchObject({ id: "tool-1", servedTo: "phone" });
    expect(await store.lenArtifactByLabel("lienzo-unknown")).toBeNull();
  });

  it("an artifact without a phone label is still found by its workspace label", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-9", slug: "nine", phoneHostLabel: null }));
    expect((await store.lenArtifactById("tool-9"))!.phoneHostLabel).toBeNull();
    expect(await store.lenArtifactByLabel("lienzo-host-tool-9")).toMatchObject({ id: "tool-9", servedTo: "workspace" });
  });

  it("two artifacts without a phone label can both be kept (a missing label is no address to share)", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-a", slug: "a", phoneHostLabel: null }));
    await store.upsertLenArtifact(toolInput({ id: "tool-b", slug: "b", phoneHostLabel: null }));
    expect((await store.lenArtifactsOf({ projectId: "space", maker: teacher })).filter((t) => t.phoneHostLabel === null).map((t) => t.id)).toEqual(["tool-a", "tool-b"]);
  });

  it("🔴 with maxPerMaker, each maker of a project has its own five: the sixth of one is refused and nothing is written", async () => {
    // Len and the teacher, both in `site`: five each.
    for (const i of [1, 2, 3, 4, 5]) {
      await store.upsertLenArtifact(toolInput({ id: `len-${i}`, assistantId: null, slug: `l${i}` }), { maxPerMaker: 5 });
      await store.upsertLenArtifact(toolInput({ id: `tea-${i}`, projectId: "site", slug: `t${i}` }), { maxPerMaker: 5 });
    }
    expect(await store.lenArtifactsOf({ projectId: "site", maker: LEN })).toHaveLength(5);
    expect(await store.lenArtifactsOf({ projectId: "site", maker: teacher })).toHaveLength(5);
    await expect(store.upsertLenArtifact(toolInput({ id: "len-6", assistantId: null, slug: "l6" }), { maxPerMaker: 5 })).rejects.toBeInstanceOf(store.LenArtifactCapError);
    await expect(store.upsertLenArtifact(toolInput({ id: "tea-6", projectId: "site", slug: "t6" }), { maxPerMaker: 5 })).rejects.toBeInstanceOf(store.LenArtifactCapError);
    expect(await store.lenArtifactsOf({ projectId: "site", maker: LEN })).toHaveLength(5);
    expect(await store.lenArtifactById("len-6")).toBeNull();
    // Republishing one at the cap is not a new one.
    expect(await store.upsertLenArtifact(toolInput({ id: "ignored", assistantId: null, slug: "l3", title: "Again" }), { maxPerMaker: 5 })).toMatchObject({ id: "len-3", title: "Again" });
    // Another project's count is its own, and so is another agent's in the same project.
    expect(await store.upsertLenArtifact(toolInput({ id: "len-other", assistantId: null, projectId: "site-2", slug: "l6" }), { maxPerMaker: 5 })).toMatchObject({ id: "len-other" });
    expect(await store.upsertLenArtifact(toolInput({ id: "fin-1", assistantId: "finance", projectId: "site", slug: "f1" }), { maxPerMaker: 5 })).toMatchObject({ id: "fin-1" });
  });

  it("🔴 two first publishes at once at four artifacts: one gets the fifth place, the other is refused", async () => {
    for (const i of [2, 3, 4]) await store.upsertLenArtifact(toolInput({ id: `tool-${i}`, slug: `s${i}` }));
    const results = await Promise.allSettled([
      store.upsertLenArtifact(toolInput({ id: "tool-x", slug: "x" }), { maxPerMaker: 5 }),
      store.upsertLenArtifact(toolInput({ id: "tool-y", slug: "y" }), { maxPerMaker: 5 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason)).toEqual([expect.any(store.LenArtifactCapError)]);
    expect(await store.lenArtifactsOf({ projectId: "space", maker: teacher })).toHaveLength(5);
  });

  it("two artifacts cannot share an address", async () => {
    await expect(store.upsertLenArtifact(toolInput({ id: "tool-8", slug: "eight", hostLabel: "lienzo-host-tool-1" }))).rejects.toThrow();
  });

  it("🔴 renaming an assistant updates its artifact in place on (projectId, assistantId, slug), preserving id, labels, docs, and the 5-artifact cap", async () => {
    // Fill teacher to the cap (5 artifacts in space).
    for (const i of [2, 3, 4, 5]) {
      await store.upsertLenArtifact(toolInput({ id: `tool-${i}`, slug: `s${i}`, folder: `/.artifacts/ana/s${i}` }), { maxPerMaker: 5 });
    }
    await store.writeDocs("tool-1", [set("progress", "1", { score: 9 })], "person");
    // Agent ana is renamed to elena and republishes the same artifact from /.artifacts/elena/lessons.
    const moved = await store.upsertLenArtifact(
      toolInput({ id: "should-not-insert", slug: "lessons", folder: "/.artifacts/elena/lessons", title: "Lessons v2", releaseSha: "sha-2", hostLabel: "lienzo-unused" }),
      { maxPerMaker: 5 },
    );
    expect(moved).toMatchObject({
      id: "tool-1",
      slug: "lessons",
      folder: "/.artifacts/elena/lessons",
      title: "Lessons v2",
      releaseSha: "sha-2",
      hostLabel: "lienzo-host-tool-1",
      phoneHostLabel: "lienzo-phone-tool-1",
    });
    expect(await store.lenArtifactsOf({ projectId: "space", maker: teacher })).toHaveLength(5);
    expect(await store.readDocs("tool-1")).toMatchObject([{ collection: "progress", docId: "1", data: { score: 9 } }]);
  });

  it("marks when its maker last looked at its data", async () => {
    const at = new Date("2026-11-22T10:30:00Z");
    await store.markMakerSeen("tool-1", at);
    expect((await store.lenArtifactById("tool-1"))!.makerSeenAt!.toISOString()).toBe(at.toISOString());
  });

  it("knows who owns a project, and nobody for one that isn't there", async () => {
    expect(await store.projectOwnerOf("site")).toBe("u1");
    expect(await store.projectOwnerOf("other-space")).toBe("u2");
    expect(await store.projectOwnerOf("nope")).toBeNull();
  });
});

describe("🔴 a version nobody points at is deleted (republishing keeps one)", () => {
  const release = (sha: string, projectId = "space") =>
    pg.query(`insert into "toolReleases" ("sha", "projectId", "files") values ($1, $2, '{}'::jsonb)`, [sha, projectId]);
  const releases = async () => (await pg.query<{ sha: string }>(`select "sha" from "toolReleases" order by "sha"`)).rows.map((r) => r.sha);

  beforeEach(async () => {
    for (const sha of ["sha-1", "sha-2", "sha-3"]) await release(sha);
  });

  it("deletes a version no artifact and no installed tool points at", async () => {
    expect(await toolStore.deleteReleaseIfUnused("sha-2")).toBe(true);
    expect(await releases()).toEqual(["sha-1", "sha-3"]);
  });

  it("keeps a version an artifact still points at", async () => {
    expect(await toolStore.deleteReleaseIfUnused("sha-1")).toBe(false);
    expect(await releases()).toEqual(["sha-1", "sha-2", "sha-3"]);
  });

  it("keeps a version ANOTHER artifact still points at, when one moved off it", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan", releaseSha: "sha-1" }));
    await store.upsertLenArtifact(toolInput({ releaseSha: "sha-3" }));
    expect(await toolStore.deleteReleaseIfUnused("sha-1")).toBe(false);
    expect(await releases()).toContain("sha-1");
  });

  it("keeps a version an installed tool points at", async () => {
    await pg.query(
      `insert into "toolInstallations" ("id", "personId", "projectId", "releaseSha", "placement", "iconPath", "hostLabel") values ('i1', 'u1', 'site', 'sha-3', 'rail', '/icon.svg', 'lienzo-install-1')`,
    );
    expect(await toolStore.deleteReleaseIfUnused("sha-3")).toBe(false);
    expect(await releases()).toContain("sha-3");
  });

  it("a version that isn't there is nothing to delete", async () => {
    expect(await toolStore.deleteReleaseIfUnused("sha-none")).toBe(false);
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

  it("an update after a delete of the same document in one batch makes it anew from the update's fields alone", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { old: true, keep: 1 })], "agent");
    const r = await store.writeDocs("tool-1", [del("c", "a"), update("c", "a", { fresh: 1 })], "agent");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.map((c) => [c.docId, c.data])).toEqual([["a", { fresh: 1 }]]);
    expect((await store.readDoc("tool-1", "c", "a"))!.data).toEqual({ fresh: 1 });
  });

  it("documents of two tools do not meet, even with the same collection and id", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan" }));
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
    const row = (await pg.query<{ bytes: number }>(`select "bytes" from "lenArtifactDocs" where "docId" = 'a'`)).rows[0]!;
    expect(row.bytes).toBe(Buffer.byteLength(JSON.stringify({ t: "é😀" }), "utf8"));
    expect(row.bytes).toBe(JSON.stringify({ t: "" }).length + 2 + 4);
  });
});

describe("reading documents by their keys", () => {
  beforeEach(async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan" }));
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
    expect(await store.readDocsByKeys("tool-1", [{ collection: "a'); drop table \"lenArtifactDocs\"; --", docId: "9" }])).toEqual([]);
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
    expect(LEN_ARTIFACT_DOCS_MAX).toBe(1000);
    expect(LEN_ARTIFACT_DOC_MAX_BYTES).toBe(64 * 1024);
    expect(LEN_ARTIFACT_DATA_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("a document of exactly 64 KB is kept; one byte more is `doc_too_big`", async () => {
    expect((await store.writeDocs("tool-1", [set("c", "ok", docOfBytes(LEN_ARTIFACT_DOC_MAX_BYTES))], "agent")).ok).toBe(true);
    expect(await store.writeDocs("tool-1", [set("c", "big", docOfBytes(LEN_ARTIFACT_DOC_MAX_BYTES + 1))], "agent")).toEqual({ ok: false, error: "doc_too_big" });
  });

  it("🔴 a batch of two with one too big writes neither", async () => {
    const r = await store.writeDocs("tool-1", [set("c", "small", { x: 1 }), set("c", "big", docOfBytes(LEN_ARTIFACT_DOC_MAX_BYTES + 1))], "person");
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
    await seed(LEN_ARTIFACT_DOCS_MAX, 2);
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
    await seed(80, LEN_ARTIFACT_DOC_MAX_BYTES);
    const full = await store.writeDocs("tool-1", [set("c", "tiny", { x: 1 })], "agent");
    expect(full).toEqual({ ok: false, error: "tool_too_big" });
    expect(await countDocs()).toBe(80);
    expect(await store.readDocs("tool-1", "c")).toEqual([]);
  });

  it("the total is the sum over the documents the batch would leave: a batch that frees room for itself passes", async () => {
    await seed(80, LEN_ARTIFACT_DOC_MAX_BYTES);
    // rewriting a 64 KB document smaller makes room for a small one in the same batch.
    const r = await store.writeDocs("tool-1", [set("seed", "d1", { x: 1 }), set("c", "tiny", { x: 1 })], "agent");
    expect(r.ok).toBe(true);
    expect(await countDocs()).toBe(81);
    // and deleting is always allowed, however full.
    expect((await store.writeDocs("tool-1", [del("seed", "d2")], "agent")).ok).toBe(true);
  });

  it("exactly 5 MB is kept", async () => {
    await seed(79, LEN_ARTIFACT_DOC_MAX_BYTES);
    const room = LEN_ARTIFACT_DATA_MAX_BYTES - 79 * LEN_ARTIFACT_DOC_MAX_BYTES;
    expect((await store.writeDocs("tool-1", [set("c", "last", docOfBytes(room))], "agent")).ok).toBe(true);
    expect(await store.writeDocs("tool-1", [set("c", "one-more", { x: 1 })], "agent")).toEqual({ ok: false, error: "tool_too_big" });
  });

  it("the caps are per tool: another tool's data does not count", async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan" }));
    await seed(80, LEN_ARTIFACT_DOC_MAX_BYTES, "tool-2");
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

describe("what an artifact's data belongs to", () => {
  beforeEach(async () => {
    await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan" }));
    await store.upsertLenArtifact(toolInput({ id: "tool-f", assistantId: "finance", slug: "budget" }));
    await store.upsertLenArtifact(toolInput({ id: "len-1", assistantId: null, slug: "board" }));
    for (const id of ["tool-1", "tool-2", "tool-f", "len-1"]) await store.writeDocs(id, [set("c", "a", { x: 1 })], "agent");
  });

  it("🔴 deleting the tool deletes its data for good, and no other tool's", async () => {
    expect(await store.deleteLenArtifact("tool-1")).toBe(true);
    expect(await store.lenArtifactById("tool-1")).toBeNull();
    expect(await store.readDocs("tool-1")).toEqual([]);
    expect(await countDocs("tool-2")).toBe(1);
    expect(await countDocs("tool-f")).toBe(1);
    expect(await store.deleteLenArtifact("tool-1")).toBe(false);
  });

  it("🔴 deleting the agent deletes its tools and their data, and no one else's", async () => {
    await pg.query(`delete from "assistants" where "id" = 'teacher'`);
    expect(await store.lenArtifactsOf({ maker: teacher })).toEqual([]);
    expect(await countDocs("tool-1")).toBe(0);
    expect(await countDocs("tool-2")).toBe(0);
    expect((await store.lenArtifactsOf({ maker: { assistantId: "finance" } })).map((t) => t.id)).toEqual(["tool-f"]);
    expect(await countDocs("tool-f")).toBe(1);
    expect(await countDocs("len-1")).toBe(1);
  });

  it("deleting a project deletes the artifacts made in it, Len's and its agents', and no other project's", async () => {
    await pg.query(`delete from "projects" where "id" = 'space'`);
    expect((await pg.query<{ id: string }>(`select "id" from "lenArtifacts"`)).rows.map((r) => r.id)).toEqual(["len-1"]);
    expect(await countDocs("tool-1")).toBe(0);
    await pg.query(`delete from "projects" where "id" = 'site'`);
    expect(await pg.query(`select 1 from "lenArtifacts"`).then((r) => r.rows)).toEqual([]);
    expect(await pg.query(`select 1 from "lenArtifactDocs"`).then((r) => r.rows)).toEqual([]);
  });
});
