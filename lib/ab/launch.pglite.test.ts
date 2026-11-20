// @vitest-environment node
// ONE LIVE EXPERIMENT PER PROJECT, UNDER CONCURRENCY (review item 15 of the first review, left open by the G1+G3 work):
// the pre-check «is another experiment live?» is a read; two launches at the same instant both pass it. The database holds
// the line — a partial UNIQUE index on the project over the live statuses — and the launch takes it BEFORE it publishes, so
// the second launch is told 409 `ab_already_running` and publishes nothing (the release carries ONE manifest).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { insertExperiment, openAbPglite, resetAbRows, type AbPglite } from "./testing/pglite";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  db: null as unknown,
  published: null as Record<string, unknown> | null,
  publishProject: vi.fn(),
  runSecurityGate: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/assistants/store", () => ({ assistantOfProject: async () => null }));
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => false }));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/len-watch/published-sources", () => ({ readPublishedSources: async () => h.published }));
vi.mock("@/lib/projects", () => ({ publishProject: h.publishProject }));
vi.mock("@/lib/projects/publish-through-gates", () => ({ runSecurityGate: h.runSecurityGate, publishThroughGates: vi.fn() }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: async () => undefined }));
vi.mock("@/lib/publish/filesystem", () => ({ rollbackToSha: vi.fn() }));
vi.mock("@/lib/ab/worktree", () => ({
  cleanupAbWorktree: vi.fn(async () => undefined),
  commitAbWorktree: h.commit,
  copySources: async () => ({ data: { html: "<html>B</html>", pages: {} }, folder: {} }),
  createAbWorktree: vi.fn(),
  ensurePublishedSources: async () => h.published,
  mergeWinnerIntoDraft: vi.fn(),
  readPublishedFolder: async () => ({}),
}));

const { AbLifecycleError, launchAbExperiment } = await import("./lifecycle");
const { getExperimentById, liveExperimentForProject } = await import("./store");

let pglite: AbPglite;
const raw = (): PGlite => pglite.raw;
const launch = (id: string) => launchAbExperiment({ projectId: "p1", experimentId: id, ownerId: "u1", actorId: "u1" });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeAll(async () => {
  pglite = await openAbPglite();
  h.db = pglite.db;
});
afterAll(async () => {
  await raw().close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  h.published = { commitOid: "base-1", data: { html: "<html>A</html>" }, extraFiles: {} };
  h.runSecurityGate.mockResolvedValue({ fingerprint: null });
  h.commit.mockResolvedValue("tip-1");
  h.publishProject.mockImplementation(async () => {
    await tick(); // a publish takes time: this is where the second launch would slip in
    return { sha: "release-experiment" };
  });
  await resetAbRows(raw());
});

const draft = (id: string, targetPath: string) =>
  insertExperiment(raw(), { id, status: "draft", targetPath, copyProjectId: `copy-${id}`, branch: `ab/${id}`, baseCommitOid: "base-1" });

describe("one live experiment per project, in the database (item 13)", () => {
  it("🔴 the index exists: two live experiments of a project can't be written, whatever the code checked", async () => {
    await insertExperiment(raw(), { id: "ab_live0001", status: "running", targetPath: "/a", startedAt: new Date() });
    await expect(insertExperiment(raw(), { id: "ab_live0002", status: "winner_ready", targetPath: "/b" })).rejects.toThrow(/duplicate key|unique/i);
    // a draft doesn't count, a finished one doesn't count, another project's doesn't count
    await insertExperiment(raw(), { id: "ab_draft001", status: "draft", targetPath: "/c" });
    await insertExperiment(raw(), { id: "ab_done0001", status: "promoted_b", targetPath: "/d" });
    await insertExperiment(raw(), { id: "ab_other001", projectId: "p2", status: "running", targetPath: "/a", startedAt: new Date() });
  });

  it("🔴 two launches of two drafts at the same instant: ONE publishes, the other is 409 ab_already_running and publishes nothing", async () => {
    await draft("ab_aaaa0001", "/");
    await draft("ab_bbbb0002", "/pricing");
    const results = await Promise.allSettled([launch("ab_aaaa0001"), launch("ab_bbbb0002")]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBeInstanceOf(AbLifecycleError);
    expect(lost[0]!.reason).toMatchObject({ code: "ab_already_running", status: 409 });
    expect(h.publishProject).toHaveBeenCalledTimes(1);

    const live = await liveExperimentForProject("p1");
    expect(live?.status).toBe("running");
    expect(live?.experimentReleaseSha).toBe("release-experiment");
    expect(live?.startedAt).toBeInstanceOf(Date);
    // the loser is still the draft it was: nothing of it ran
    const loserId = live!.id === "ab_aaaa0001" ? "ab_bbbb0002" : "ab_aaaa0001";
    expect(await getExperimentById(loserId)).toMatchObject({ status: "draft", startedAt: null });
  });

  it("the same draft launched twice at once: one launch, the other says it can't be launched from where it is", async () => {
    await draft("ab_cccc0003", "/");
    const results = await Promise.allSettled([launch("ab_cccc0003"), launch("ab_cccc0003")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(lost.reason).toMatchObject({ status: 409 });
    expect(h.publishProject).toHaveBeenCalledTimes(1);
  });

  it("🔴 a publish that fails gives the claim back: the experiment is a draft again and the project has no live one", async () => {
    await draft("ab_dddd0004", "/");
    h.publishProject.mockRejectedValueOnce(new Error("disco lleno"));
    await expect(launch("ab_dddd0004")).rejects.toThrow(/disco lleno/);
    expect(await getExperimentById("ab_dddd0004")).toMatchObject({ status: "draft", startedAt: null });
    expect(await liveExperimentForProject("p1")).toBeNull();
    // and it can be launched again
    await expect(launch("ab_dddd0004")).resolves.toBeDefined();
    expect((await getExperimentById("ab_dddd0004"))!.status).toBe("running");
  });
});
