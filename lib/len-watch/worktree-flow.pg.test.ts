// @vitest-environment node
//
// THE WHOLE WORKTREE FLOW, FOR REAL (spec local 2026-10-30-len-watch, §5.5): the site is published; the owner goes on
// editing; it crashes; Len fixes a worktree of what is published and the branch goes out — with the fix and WITHOUT
// the owner's edit; the owner's next publish waits; «Traer el arreglo» brings it into the draft, keeping their edit;
// then their publish carries both. Only Len's turn, the browser check and the notices are faked: the database,
// git, the worktree and publishing (into a temporary PUBLISH_ROOT) are the real ones.
//
// 🔴 Runs ONLY when DATABASE_URL is a throwaway database and LEN_WATCH_TEST_DATABASE_URL names the same one.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const ROOT = mkdtempSync(path.join(tmpdir(), "ol-len-watch-flow-"));
process.env.PUBLISH_ROOT = ROOT;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
process.env.OPENLEN_IMAGERY = "0";
process.env.NEXTAUTH_SECRET ??= "test-secret-for-len-watch-flow";

const URL = process.env.LEN_WATCH_TEST_DATABASE_URL;
const RUN_IT = !!URL && process.env.DATABASE_URL === URL;

const page = (body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Holi</title></head><body>${body}<script src="/js/app.js"></script></body></html>`;
const DOWN = { loads: false, reason: "blank" as const, errors: ["kaput"] };
const UP = { loads: true, reason: "ok" as const, errors: [] };

describe.skipIf(!RUN_IT)("the Len Watch worktree, from the crash to the owner's next publish", () => {
  const RUN = Math.random().toString(36).slice(2, 8);
  const OWNER = `lw-wf-owner-${RUN}`;
  const PROJECT = `lw-wf-project-${RUN}`;
  const SUB = `lwwf${RUN}`;
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

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
    await db.insert(schema.projects).values({ id: PROJECT, userId: OWNER, title: "Holi", brief: "", data: { html: page('<p id="m">Hola</p>') } });
    await db.insert(schema.projectFiles).values({ projectId: PROJECT, path: "/js/app.js", content: "crash();" });
  });

  afterAll(async () => {
    if (!RUN_IT) return;
    const { db, schema } = await import("@/lib/db");
    const { eq, or } = await import("drizzle-orm");
    await db.delete(schema.projects).where(or(eq(schema.projects.id, PROJECT), eq(schema.projects.parentProjectId, PROJECT)));
    await db.delete(schema.users).where(eq(schema.users.id, OWNER));
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("the site gets only the fix; the owner's publish waits; brought in, the next publish carries both", async () => {
    const { db, schema } = await import("@/lib/db");
    const { eq, and } = await import("drizzle-orm");
    const { publishThroughGates } = await import("@/lib/projects/publish-through-gates");
    const { readPublishedSources } = await import("./published-sources");
    const store = await import("./store");
    const owner = await import("./owner");
    const orchestrate = await import("./orchestrate");
    const wt = await import("./worktree");
    const { bringFix } = await import("./bring");
    const { listProjects } = await import("@/lib/projects");
    const base = { projectId: PROJECT, actorId: OWNER, ownerId: OWNER, subdomain: SUB };
    const file = async (projectId: string, p: string) =>
      (await db.select({ c: schema.projectFiles.content }).from(schema.projectFiles).where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, p))))[0]?.c;
    const draftHtml = async () => (await db.select({ d: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, PROJECT)))[0]!.d.html ?? "";

    // 1. Published; what went out is kept.
    expect((await publishThroughGates({ ...base, source: "person" })).status).toBe(200);
    await vi.waitFor(async () => expect(await readPublishedSources(PROJECT)).not.toBeNull(), { timeout: 10_000 });

    // 2. The owner goes on editing (not published).
    await db.update(schema.projects).set({ data: { html: page('<p id="m">Hola</p><p>owner-edit</p>') } }).where(eq(schema.projects.id, PROJECT));

    // 3. It crashes, with «fix» and «publish on its own» on.
    await store.saveSettings(PROJECT, { autoFix: true, autoPublish: true });
    const incident = (await store.openIncident(PROJECT, { message: "boom", file: "/js/app.js", line: 1, col: 1, page: null }))!;
    const p = (await owner.projectForWatch(PROJECT))!;
    const launched: { projectId: string; chatProjectId?: string; reply: (t: string, c: [], f?: string) => Promise<void> }[] = [];
    const checks = [DOWN, UP, UP];
    const { readPublishedSources: rps } = await import("./published-sources");
    const deps: import("./orchestrate").OrchestratorDeps = {
      store,
      worktree: {
        add: wt.addWorktree,
        commitLeftovers: wt.commitLeftovers,
        touches: wt.branchTouches,
        remove: wt.removeWorktree,
        deleteBranch: wt.deleteBranch,
        publishedCommit: async (id) => (await rps(id))?.commitOid ?? null,
      },
      project: owner.projectForWatch,
      check: async () => checks.shift() ?? UP,
      notify: async () => undefined,
      launch: (x) => void launched.push(x as never),
      publish: publishThroughGates,
      hasUnpublished: async () => true,
      contentStamp: orchestrate.contentStamp,
      failPhrase: () => "x",
      turnPrompt: () => "Tu sitio publicado no carga.",
      interruptedPhrase: () => "x",
      liveTurn: () => false,
      now: Date.now,
      newId: () => `row-${RUN}`,
    };
    await orchestrate.startFix(incident, p, deps, { check: DOWN });

    // 4. Len works in the worktree: what was published, not the draft, on its branch.
    const turn = launched[0]!;
    expect(turn.chatProjectId).toBe(PROJECT);
    const copyId = turn.projectId;
    expect(copyId).not.toBe(PROJECT);
    expect(await file(copyId, "/js/app.js")).toBe("crash();");
    // Len's fix, in the copy (left without a commit: OpenLen commits it on the branch).
    await db.update(schema.projectFiles).set({ content: "ok();" }).where(and(eq(schema.projectFiles.projectId, copyId), eq(schema.projectFiles.path, "/js/app.js")));
    await turn.reply("Voy a mirar.\n\nArreglado: app.js llamaba a algo que no existe.", [], "Arreglado: app.js llamaba a algo que no existe.");

    // 5. The fix is out — without the owner's edit — and the draft is untouched.
    expect(served("js/app.js")).toContain("ok();");
    expect(served("index.html")).not.toContain("owner-edit");
    expect(await draftHtml()).toContain("owner-edit");
    expect(await file(PROJECT, "/js/app.js")).toBe("crash();");
    const done = (await store.incidentById(incident.id))!;
    expect(done).toMatchObject({ status: "resolved", resolution: "fixed", bringState: "pending", copyProjectId: null });
    expect((await listProjects(OWNER)).map((x) => x.id)).not.toContain(copyId);

    // 6. The owner's publish waits for the fix.
    expect(await publishThroughGates({ ...base, source: "person" })).toEqual({ status: 428, body: { error: "len_watch_fix_pending", incidentId: incident.id, branch: done.branch } });

    // 7. «Traer el arreglo»: the fix enters the draft, their edit stays.
    expect(await bringFix({ projectId: PROJECT, incidentId: incident.id, actorId: OWNER })).toEqual({ status: "brought" });
    expect(await file(PROJECT, "/js/app.js")).toBe("ok();");
    expect(await draftHtml()).toContain("owner-edit");
    expect(await wt.branchTip(PROJECT, done.branch!)).toBeNull();

    // 8. Their next publish carries both.
    expect((await publishThroughGates({ ...base, source: "person" })).status).toBe(200);
    expect(served("index.html")).toContain("owner-edit");
    expect(served("js/app.js")).toContain("ok();");
  });
});
