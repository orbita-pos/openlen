// @vitest-environment node
//
// THE FIX'S WORKTREE AGAINST REAL POSTGRES (spec local 2026-10-30-len-watch, §5.5): it starts at what was published,
// not at the owner's draft; its branch lives in the project's repository; the copy is never listed, belongs to the
// parent's owner and members and uses the parent's backend; removing it keeps the branch.
//
// 🔴 Runs ONLY with LEN_WATCH_TEST_DATABASE_URL, a throwaway database (`@/lib/db` is replaced by a client on it):
//   LEN_WATCH_TEST_DATABASE_URL=postgresql://openlen@127.0.0.1:55432/openlen_lw npx vitest run lib/len-watch/worktree.pg.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { makePointer } from "@/lib/files/blob-pointer";

const URL = process.env.LEN_WATCH_TEST_DATABASE_URL;

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return holder.db;
    },
  };
});

const POINTER = makePointer({ sha256: "c".repeat(64), size: 9, gitOid: "d".repeat(40) });

describe.skipIf(!URL)("the fix's worktree against real Postgres", () => {
  const RUN = Math.random().toString(36).slice(2, 8);
  const OWNER = `lw-wt-owner-${RUN}`;
  const EDITOR = `lw-wt-editor-${RUN}`;
  const PARENT = `lw-wt-parent-${RUN}`;
  const BARE = `lw-wt-bare-${RUN}`;
  const DATA = { html: "<p>Home</p>", pages: { precios: { html: "<p>$</p>" } } };
  let pool: import("pg").Pool;
  let wt: typeof import("./worktree");

  beforeAll(async () => {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    pool = new Pool({ connectionString: URL });
    holder.db = drizzle(pool, { schema });
    for (const u of [OWNER, EDITOR]) await pool.query(`INSERT INTO "users" ("id", "email", "name") VALUES ($1, $2, 'Ana')`, [u, `${u}@test.invalid`]);
    for (const id of [PARENT, BARE]) {
      await pool.query(`INSERT INTO "projects" ("id", "userId", "title", "brief", "data") VALUES ($1, $2, 'Holi', '', $3)`, [id, OWNER, JSON.stringify(DATA)]);
    }
    await pool.query(`INSERT INTO "projectMembers" ("id", "projectId", "userId", "rol") VALUES ($1, $2, $3, 'editor')`, [`m-${RUN}`, PARENT, EDITOR]);
    await pool.query(`INSERT INTO "projectEnvVars" ("projectId", "name", "target", "value") VALUES ($1, 'VITE_SHOP', 'production', 'live-shop')`, [PARENT]);
    // The mock's factory is async: resolve it before any parallel `import()` (recordPublishedSources imports
    // @/lib/db and @/lib/git/service together), or one of them gets the real module.
    await import("@/lib/db");
    const { recordPublishedSources } = await import("./published-sources");
    const folder = { "/src/App.tsx": "published", "/img/logo.webp": POINTER, "/.openlen/esm-lock.json": "{}" };
    await recordPublishedSources({ projectId: PARENT, ownerId: OWNER, data: DATA, folder });
    // The owner went on editing after publishing: the draft is not what was published.
    await pool.query(`INSERT INTO "projectFiles" ("projectId", "path", "content") VALUES ($1, '/src/App.tsx', 'draft')`, [PARENT]);
    wt = await import("./worktree");
  });

  afterAll(async () => {
    await pool?.query(`DELETE FROM "projects" WHERE "id" IN ($1, $2) OR "parentProjectId" IN ($1, $2)`, [PARENT, BARE]);
    await pool?.query(`DELETE FROM "users" WHERE "id" IN ($1, $2)`, [OWNER, EDITOR]);
    await pool?.end();
  });

  it("the worktree starts at what was published, not at the draft", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i1-${RUN}` }))!;
    const { data, folder } = await wt.copySources(w.copyId);
    expect(folder["/src/App.tsx"]).toBe("published");
    expect(data.pages?.precios?.html).toBe("<p>$</p>");
    // What git never sees travels too.
    expect(folder["/.openlen/esm-lock.json"]).toBe("{}");
  });

  it("a binary of the folder arrives as its pointer", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i2-${RUN}` }))!;
    expect((await wt.copySources(w.copyId)).folder["/img/logo.webp"]).toBe(POINTER);
  });

  it("its branch is len-watch/<incident> at the published commit, and git branch in the parent shows it", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i3-${RUN}` }))!;
    expect(w.branch).toBe(`len-watch/i3-${RUN}`);
    expect(await wt.branchTip(PARENT, w.branch)).toBe(w.base);
    const { postgresStore } = await import("@/lib/git/postgres-store");
    const { runGit } = await import("@/lib/git/run");
    const who = { name: "Ana", email: "a@test.invalid" };
    const out = await runGit({ store: postgresStore(PARENT), files: {}, cwd: "/", identity: who, owner: who, now: () => new Date() }, ["branch"]);
    expect(out.stdout).toContain(`  len-watch/i3-${RUN}\n`);
    expect(out.stdout).toContain("* main\n");
  });

  it("the copy never appears in the owner's projects, and its owner and members are the parent's", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i4-${RUN}` }))!;
    const { listProjects } = await import("@/lib/projects");
    expect((await listProjects(OWNER)).map((p) => p.id)).not.toContain(w.copyId);
    const { accesoAlProyecto } = await import("@/lib/projects/acceso");
    expect((await accesoAlProyecto(w.copyId, EDITOR))?.rol).toBe("editor");
  });

  it("in the copy, the backend and its variables are the parent's", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i5-${RUN}` }))!;
    const { rootProject } = await import("@/lib/projects/root-project");
    expect(await rootProject(w.copyId)).toBe(PARENT);
    const { envVarsFor } = await import("@/lib/apps/env/store");
    expect(await envVarsFor(w.copyId, "production")).toEqual({ VITE_SHOP: "live-shop" });
  });

  it("Len's leftovers go in a commit on the branch, and only there", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i6-${RUN}` }))!;
    await pool.query(`UPDATE "projectFiles" SET "content" = 'fixed' WHERE "projectId" = $1 AND "path" = '/src/App.tsx'`, [w.copyId]);
    const tip = await wt.commitLeftovers(w.copyId, OWNER, "Fix the crash");
    expect(tip).not.toBe(w.base);
    expect(await wt.branchTip(PARENT, w.branch)).toBe(tip);
    expect(await wt.branchTouches(PARENT, w.base, tip, "/src/")).toBe(true);
    expect(await wt.branchTouches(PARENT, w.base, tip, "/supabase/migrations/")).toBe(false);
    // Nothing left: the tip doesn't move.
    expect(await wt.commitLeftovers(w.copyId, OWNER, "again")).toBe(tip);
    const { rows } = await pool.query(`SELECT "content" FROM "projectFiles" WHERE "projectId" = $1 AND "path" = '/src/App.tsx'`, [PARENT]);
    expect(rows[0].content).toBe("draft");
  });

  it("removeWorktree deletes the copy and keeps the branch", async () => {
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i7-${RUN}` }))!;
    await wt.removeWorktree(w.copyId);
    const { rows } = await pool.query(`SELECT 1 FROM "projects" WHERE "id" = $1`, [w.copyId]);
    expect(rows).toHaveLength(0);
    expect(await wt.branchTip(PARENT, w.branch)).toBe(w.base);
    await wt.deleteBranch(PARENT, w.branch);
    expect(await wt.branchTip(PARENT, w.branch)).toBeNull();
  });

  it("without published sources there is no worktree", async () => {
    expect(await wt.addWorktree({ parentId: BARE, ownerId: OWNER, incidentId: `i8-${RUN}` })).toBeNull();
  });
});
