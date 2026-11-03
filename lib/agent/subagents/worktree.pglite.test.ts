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
