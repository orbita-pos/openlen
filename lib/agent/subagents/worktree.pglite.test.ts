// @vitest-environment node
//
// AN ISOLATED CHILD'S COPY (spec local 2026-11-02-subagentes-de-len-fase-4, §4.2–§4.4) against real Postgres (PGlite),
// with the tables it touches as their migrations create them: the copy is the draft as it is, on its own branch of the
// parent's repository, and what it changed comes back into the draft, all or nothing.
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

await import("@/lib/db");
const wt = await import("./worktree");
const { postgresStore } = await import("@/lib/git/postgres-store");
const { runGit } = await import("@/lib/git/run");
const { identityOf } = await import("@/lib/git/service");
const { snapshotFiles } = await import("@/lib/len-watch/published-sources");

let pg: PGlite;
const DATA = { html: "<p>Home</p>" };

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table "users" ("id" text primary key, "name" text, "handle" text);
    create table "projects" (
      "id" text primary key, "userId" text not null, "title" text not null default '', "brief" text not null default '',
      "data" jsonb not null, "userBrief" text, "filesHash" text,
      "parentProjectId" text references "projects"("id") on delete cascade,
      -- The rest of the columns a Drizzle insert names (with default), as nullable here.
      "status" text, "visibility" text, "remixedFromId" text, "remixCount" integer, "listedAt" timestamp, "tags" jsonb,
      "deployUrl" text, "thumbnailUrl" text, "logoUrl" text, "subdomain" text, "publishedAt" timestamp, "publishedHtml" text,
      "publishedHomeHash" text, "publishedPagesHash" text, "publishedFilesHash" text, "envHash" text, "publishedEnvHash" text,
      "publishedReleaseSha" text, "topeMensualMiembros" integer, "createdAt" timestamp default now(), "updatedAt" timestamp default now());
    create table "projectFiles" (
      "projectId" text not null references "projects"("id") on delete cascade,
      "path" text not null, "content" text not null, "updatedAt" timestamp not null default now(),
      primary key ("projectId", "path"));
    create table "projectGitObjects" (
      "projectId" text not null references "projects"("id") on delete cascade,
      "oid" text not null, "type" text not null, "content" bytea not null, "blobPointer" text,
      "createdAt" timestamp not null default now(), primary key ("projectId", "oid"));
    create table "projectGitRepos" (
      "projectId" text primary key references "projects"("id") on delete cascade,
      "head" text not null, "index" jsonb not null, "version" integer not null default 0,
      "refs" jsonb not null default '{}', "currentBranch" text not null default 'main', "mergeState" jsonb,
      "remotes" jsonb not null default '{}', "upstreams" jsonb not null default '{}',
      "createdAt" timestamp not null default now(), "updatedAt" timestamp not null default now());
    insert into "users" values ('owner', 'Ana', 'ana');
  `);
  await pg.query(`insert into "projects" ("id", "userId", "data", "userBrief") values ('p', 'owner', $1, 'Use the blue.')`, [JSON.stringify(DATA)]);
  await pg.query(`insert into "projectFiles" ("projectId", "path", "content") values ('p', '/src/a.ts', 'export const a = 1;\n')`);
  base.db = drizzle(pg, { schema });
});

const filesOf = async (projectId: string) =>
  Object.fromEntries((await pg.query<{ path: string; content: string }>(`select "path", "content" from "projectFiles" where "projectId" = $1 order by "path"`, [projectId])).rows.map((r) => [r.path, r.content]));
const projectRow = async (id: string) => (await pg.query<{ data: unknown; userBrief: string | null; parentProjectId: string | null }>(`select "data", "userBrief", "parentProjectId" from "projects" where "id" = $1`, [id])).rows[0];

/** A git command in the parent, as the terminal runs it. */
async function gitInParent(args: string[]) {
  const r = (await projectRow("p"))!;
  const who = await identityOf("owner");
  return runGit({ store: postgresStore("p"), files: snapshotFiles(r.data as never, await filesOf("p")).versioned, cwd: "/", identity: who, owner: who, now: () => new Date() }, args);
}

describe("an isolated child's copy", () => {
  it("agentBranchName takes the next free name", () => {
    expect(wt.agentBranchName("ab12", new Set())).toBe("worktree-agent-ab12");
    expect(wt.agentBranchName("ab12", new Set(["worktree-agent-ab12"]))).toBe("worktree-agent-ab12-2");
    expect(wt.agentBranchName("ab12", new Set(["worktree-agent-ab12", "worktree-agent-ab12-2"]))).toBe("worktree-agent-ab12-3");
  });

  it("the copy is the draft as it is", async () => {
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "ab12" });
    expect(w.branch).toBe("worktree-agent-ab12");
    expect(await filesOf(w.copyId)).toEqual({ "/src/a.ts": "export const a = 1;\n" });
    expect(await projectRow(w.copyId)).toEqual({ data: DATA, userBrief: "Use the blue.", parentProjectId: "p" });
    const parent = (await postgresStore("p").readRepo())!;
    expect(parent.refs[w.branch]).toBe(w.base);
    // The parent's own branch never moved: the base hangs off it, like a stash.
    expect(parent.refs.main ?? null).not.toBe(w.base);
    expect(parent.branch).toBe("main");
    const copy = (await postgresStore(w.copyId).readRepo())!;
    expect(copy.head).toBe(w.base);
    expect(copy.branch).toBe(w.branch);
  });

  it("an edit the draft has not committed is in the copy", async () => {
    // Git's first use makes the repository with an "Initial commit" of everything (`ensureRepository`).
    const add = await gitInParent(["add", "-A"]);
    expect(add.exitCode, add.stderr).toBe(0);
    expect((await gitInParent(["log", "--oneline"])).stdout.trim().split("\n")).toHaveLength(1);
    await pg.query(`update "projectFiles" set "content" = 'export const a = 2;\n' where "projectId" = 'p' and "path" = '/src/a.ts'`);
    const head = (await postgresStore("p").readRepo())!.head;
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "cd34" });
    expect((await filesOf(w.copyId))["/src/a.ts"]).toBe("export const a = 2;\n");
    const after = (await postgresStore("p").readRepo())!;
    expect(after.head).toBe(head);
    expect((await gitInParent(["log", "--oneline"])).stdout.trim().split("\n")).toHaveLength(1);
  });

  it("the copy goes with its parent", async () => {
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "ef56" });
    await pg.query(`delete from "projects" where "id" = 'p'`);
    expect(await projectRow(w.copyId)).toBeUndefined();
  });
});

/** A file of a project as its tools would write it: `/index.html` is the home page in `data`, the rest is the folder. */
async function write(projectId: string, path: string, content: string | null) {
  if (path === "/index.html") {
    await pg.query(`update "projects" set "data" = jsonb_set("data", '{html}', to_jsonb($2::text)) where "id" = $1`, [projectId, content ?? ""]);
    return;
  }
  if (content === null) await pg.query(`delete from "projectFiles" where "projectId" = $1 and "path" = $2`, [projectId, path]);
  else await pg.query(`insert into "projectFiles" ("projectId", "path", "content") values ($1, $2, $3) on conflict ("projectId", "path") do update set "content" = excluded."content"`, [projectId, path, content]);
}

/** What `guardarLoDeLaTerminal` does for the launcher, here straight on the draft; `refuse` plays a guard. */
function saver(refuse: (path: string, deleted: boolean) => boolean = () => false) {
  const calls: unknown[][] = [];
  const save = async (cambios: readonly import("@/lib/agent/terminal/ficheros").CambioDeLaTerminal[], draft: Readonly<Record<string, string>>) => {
    calls.push([cambios, draft]);
    if (cambios.some((c) => refuse(c.ruta, c.tipo === "borrado"))) return { rechazado: true };
    for (const c of cambios) await write("p", c.ruta, c.tipo === "borrado" ? null : c.contenido);
    return { rechazado: false };
  };
  return { save, calls };
}

const finish = (w: import("./worktree").AgentWorktree, save: ReturnType<typeof saver>["save"], onPlanned?: () => Promise<void>) =>
  wt.finishAgentWorktree({ parentId: "p", ownerId: "owner", w, description: "Change the copy", save, ...(onPlanned ? { onPlanned } : {}) });
const branchTip = async (branch: string) => (await postgresStore("p").readRepo())?.refs[branch];
const THREE = "line one\nline two\nline three\n";

describe("bringing the copy back", () => {
  it("nothing changed", async () => {
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "n1" });
    const r = await finish(w, saver().save);
    expect(r).toEqual({ outcome: { state: "nothing" }, changes: null });
    expect(await projectRow(w.copyId)).toBeUndefined();
    expect(await branchTip(w.branch)).toBeUndefined();
  });

  it("what the child changed lands in the draft", async () => {
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "b1" });
    await write(w.copyId, "/src/a.ts", "export const a = 9;\n");
    await write(w.copyId, "/src/b.ts", "export const b = 1;\n");
    const r = await finish(w, saver().save);
    expect(r.outcome).toEqual({ state: "brought", files: ["/src/a.ts", "/src/b.ts"] });
    expect(await filesOf("p")).toEqual({ "/src/a.ts": "export const a = 9;\n", "/src/b.ts": "export const b = 1;\n" });
    expect(await projectRow(w.copyId)).toBeUndefined();
    expect(await branchTip(w.branch)).toBeUndefined();
    expect(r.changes?.before["/src/a.ts"]).toBe("export const a = 1;\n");
    expect(r.changes?.after["/src/b.ts"]).toBe("export const b = 1;\n");
  });

  it("the draft's own pending edits are not a clash", async () => {
    expect((await gitInParent(["add", "-A"])).exitCode).toBe(0);
    await write("p", "/index.html", "<p>Home, edited and not committed</p>");
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "d1" });
    await write(w.copyId, "/src/a.ts", "export const a = 9;\n");
    const r = await finish(w, saver().save);
    expect(r.outcome).toEqual({ state: "brought", files: ["/src/a.ts"] });
    expect(((await projectRow("p"))!.data as { html: string }).html).toBe("<p>Home, edited and not committed</p>");
  });

  it("different lines of the same file mix", async () => {
    await write("p", "/src/a.ts", THREE);
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "m1" });
    await write(w.copyId, "/src/a.ts", THREE.replace("line one", "LINE ONE"));
    await write("p", "/src/a.ts", THREE.replace("line three", "LINE THREE"));
    const r = await finish(w, saver().save);
    expect(r.outcome).toEqual({ state: "brought", files: ["/src/a.ts"] });
    expect((await filesOf("p"))["/src/a.ts"]).toBe("LINE ONE\nline two\nLINE THREE\n");
  });

  it("the same lines clash and nothing enters", async () => {
    await write("p", "/src/a.ts", THREE);
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "c1" });
    await write(w.copyId, "/src/a.ts", THREE.replace("line one", "child's one"));
    await write(w.copyId, "/src/c.ts", "export const c = 1;\n");
    await write("p", "/src/a.ts", THREE.replace("line one", "Len's one"));
    const before = await filesOf("p");
    const r = await finish(w, saver().save);
    expect(r).toEqual({ outcome: { state: "conflict", files: ["/src/a.ts"], branch: w.branch }, changes: null });
    expect(await filesOf("p")).toEqual(before);
    expect((await gitInParent(["show", `${w.branch}:src/a.ts`])).stdout).toBe(THREE.replace("line one", "child's one"));
    expect(await projectRow(w.copyId)).toBeUndefined();
  });

  it("what the guards refuse counts as a clash", async () => {
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "g1" });
    await write(w.copyId, "/src/a.ts", null);
    const r = await finish(w, saver((path, deleted) => deleted && path === "/src/a.ts").save);
    expect(r.outcome).toEqual({ state: "conflict", files: ["/src/a.ts"], branch: w.branch });
    expect((await filesOf("p"))["/src/a.ts"]).toBe("export const a = 1;\n");
    expect(await branchTip(w.branch)).toBeDefined();
  });

  it("a write by Len between planning and writing is kept", async () => {
    await write("p", "/src/a.ts", THREE);
    const w = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "l1" });
    await write(w.copyId, "/src/a.ts", THREE.replace("line one", "LINE ONE"));
    let first = true;
    const r = await finish(w, saver().save, async () => {
      if (!first) return;
      first = false;
      await write("p", "/src/a.ts", THREE.replace("line three", "LINE THREE"));
    });
    expect(r.outcome).toEqual({ state: "brought", files: ["/src/a.ts"] });
    expect((await filesOf("p"))["/src/a.ts"]).toBe("LINE ONE\nline two\nLINE THREE\n");
  });

  it("two copies of the same draft", async () => {
    await write("p", "/src/a.ts", THREE);
    const a = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "ta" });
    const b = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "tb" });
    await write(a.copyId, "/src/a.ts", THREE.replace("line one", "A's one"));
    await write(b.copyId, "/src/c.ts", "export const c = 1;\n");
    expect((await finish(a, saver().save)).outcome.state).toBe("brought");
    expect((await finish(b, saver().save)).outcome.state).toBe("brought");
    expect(await filesOf("p")).toEqual({ "/src/a.ts": THREE.replace("line one", "A's one"), "/src/c.ts": "export const c = 1;\n" });

    const c = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "tc" });
    const d = await wt.addAgentWorktree({ parentId: "p", ownerId: "owner", runId: "td" });
    await write(c.copyId, "/src/a.ts", THREE.replace("line one", "C's one"));
    await write(d.copyId, "/src/a.ts", THREE.replace("line one", "D's one"));
    expect((await finish(c, saver().save)).outcome.state).toBe("brought");
    expect((await finish(d, saver().save)).outcome).toEqual({ state: "conflict", files: ["/src/a.ts"], branch: d.branch });
    expect((await filesOf("p"))["/src/a.ts"]).toBe(THREE.replace("line one", "C's one"));
  });
});
