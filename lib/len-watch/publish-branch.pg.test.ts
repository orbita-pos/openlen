// @vitest-environment node
//
// PUBLISHING A LEN WATCH BRANCH, FOR REAL (spec local 2026-10-30-len-watch, §5.5 step 4): the site is published, the
// owner goes on editing, the fix is made in a worktree, and publishing the branch puts the fix on the site — not the
// owner's edits — without touching their draft. Real publishProject into a temporary PUBLISH_ROOT.
//
// 🔴 Runs ONLY when DATABASE_URL is a throwaway database and LEN_WATCH_TEST_DATABASE_URL names the same one:
//   DATABASE_URL=… LEN_WATCH_TEST_DATABASE_URL=… npx vitest run lib/len-watch/publish-branch.pg.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const ROOT = mkdtempSync(path.join(tmpdir(), "ol-len-watch-branch-"));
process.env.PUBLISH_ROOT = ROOT;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
process.env.OPENLEN_IMAGERY = "0";
process.env.NEXTAUTH_SECRET ??= "test-secret-for-len-watch-branch";

const URL = process.env.LEN_WATCH_TEST_DATABASE_URL;
const RUN_IT = !!URL && process.env.DATABASE_URL === URL;

const page = (body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Holi</title></head><body>${body}<script src="/js/app.js"></script></body></html>`;

describe.skipIf(!RUN_IT)("publishing a Len Watch branch", () => {
  const RUN = Math.random().toString(36).slice(2, 8);
  const OWNER = `lw-pb-owner-${RUN}`;
  const PARENT = `lw-pb-parent-${RUN}`;
  const SUB = `lwpb${RUN}`;
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

  const served = (file: string) => {
    const base = path.join(ROOT, SUB);
    const sha = readFileSync(path.join(base, "current"), "utf8").trim();
    return readFileSync(path.join(base, "releases", sha, file), "utf8");
  };

  beforeAll(async () => {
    const { exigirBaseLocal } = await import("@/lib/len-bench/entorno");
    await exigirBaseLocal();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({ id: OWNER, email: `${OWNER}@test.invalid`, name: "Ana" });
    await db.insert(schema.projects).values({ id: PARENT, userId: OWNER, title: "Holi", brief: "", data: { html: page('<p id="m">v1</p>') } });
    await db.insert(schema.projectFiles).values({ projectId: PARENT, path: "/js/app.js", content: "console.log('v1');" });
  });

  afterAll(async () => {
    if (!RUN_IT) return;
    const { db, schema } = await import("@/lib/db");
    const { eq, inArray } = await import("drizzle-orm");
    await db.delete(schema.projects).where(inArray(schema.projects.id, [PARENT]));
    await db.delete(schema.projects).where(eq(schema.projects.parentProjectId, PARENT));
    await db.delete(schema.users).where(eq(schema.users.id, OWNER));
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("puts the fix on the site, not the owner's edits, and leaves their draft as it was", async () => {
    const { db, schema } = await import("@/lib/db");
    const { eq, and } = await import("drizzle-orm");
    const { publishThroughGates } = await import("@/lib/projects/publish-through-gates");
    const { readPublishedSources } = await import("./published-sources");
    const wt = await import("./worktree");
    const base = { projectId: PARENT, actorId: OWNER, ownerId: OWNER, subdomain: SUB };

    expect((await publishThroughGates({ ...base, source: "person" })).status).toBe(200);
    await vi.waitFor(async () => expect(await readPublishedSources(PARENT)).not.toBeNull(), { timeout: 10_000 });
    const first = (await readPublishedSources(PARENT))!.commitOid;

    // The owner goes on editing.
    await db.update(schema.projects).set({ data: { html: page('<p id="m">v1</p><p>draft-edit</p>') } }).where(eq(schema.projects.id, PARENT));
    await db.update(schema.projectFiles).set({ content: "console.log('draft');" }).where(and(eq(schema.projectFiles.projectId, PARENT), eq(schema.projectFiles.path, "/js/app.js")));

    // Len fixes it in the worktree.
    const w = (await wt.addWorktree({ parentId: PARENT, ownerId: OWNER, incidentId: `i-${RUN}` }))!;
    await db.update(schema.projects).set({ data: { html: page('<p id="m">fixed</p>') } }).where(eq(schema.projects.id, w.copyId));
    await db.update(schema.projectFiles).set({ content: "console.log('fixed');" }).where(and(eq(schema.projectFiles.projectId, w.copyId), eq(schema.projectFiles.path, "/js/app.js")));

    expect((await publishThroughGates({ ...base, source: "len_watch", sourcesFrom: w.copyId })).status).toBe(200);
    expect(served("index.html")).toContain("fixed");
    expect(served("index.html")).not.toContain("draft-edit");
    expect(served("js/app.js")).toContain("fixed");

    const [parent] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, PARENT));
    expect(parent!.data.html).toContain("draft-edit");
    const [file] = await db.select({ content: schema.projectFiles.content }).from(schema.projectFiles).where(and(eq(schema.projectFiles.projectId, PARENT), eq(schema.projectFiles.path, "/js/app.js")));
    expect(file!.content).toBe("console.log('draft');");

    // What is kept as published is now the branch's content.
    await vi.waitFor(async () => expect((await readPublishedSources(PARENT))!.commitOid).not.toBe(first), { timeout: 10_000 });
    expect((await readPublishedSources(PARENT))!.data.html).toContain("fixed");
  });
});
