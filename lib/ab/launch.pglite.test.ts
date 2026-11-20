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
  createWorktree: vi.fn(),
  cleanup: vi.fn(),
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
  cleanupAbWorktree: h.cleanup,
  commitAbWorktree: h.commit,
  copySources: async () => ({ data: { html: "<html>B</html>", pages: {} }, folder: {} }),
  createAbWorktree: h.createWorktree,
  ensurePublishedSources: async () => h.published,
  mergeWinnerIntoDraft: vi.fn(),
  readPublishedFolder: async () => ({}),
}));

const { AbLifecycleError, createAbDraft, launchAbExperiment } = await import("./lifecycle");
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
  h.cleanup.mockResolvedValue(undefined);
  h.createWorktree.mockResolvedValue({ copyId: "copy-new", branch: "ab/new", base: "base-1" });
  h.publishProject.mockImplementation(async () => {
    await tick(); // a publish takes time: this is where the second launch would slip in
    return { sha: "release-experiment" };
  });
  await resetAbRows(raw());
});

const draft = (id: string, targetPath: string) =>
  insertExperiment(raw(), { id, status: "draft", targetPath, copyProjectId: `copy-${id}`, branch: `ab/${id}`, baseCommitOid: "base-1", controlReleaseSha: "rel-live" });

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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A DRAFT CUT FROM A VERSION THAT IS NO LONGER THE SITE (G1+G3 review, items 16 and 17): the launch refuses it — and the
// refusal must leave a way forward. It used to leave the stale draft alive, which counts as active, so the re-cut the message
// promised answered `already_active`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("base_moved leaves a way forward (item 16)", () => {
  it("🔴 the refusal cancels the stale draft and says so; Len can then cut the variant again for the same page", async () => {
    await draft("ab_stale001", "/");
    h.published = { commitOid: "base-2-published-since", data: { html: "<html>A2</html>" }, extraFiles: {} };
    const err = await launch("ab_stale001").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbLifecycleError);
    expect(err).toMatchObject({ code: "base_moved", status: 409 });
    expect((err as Error).message).toMatch(/discarded/i);
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(await getExperimentById("ab_stale001")).toMatchObject({ status: "cancelled", copyProjectId: null });
    expect(h.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: "copy-ab_stale001", branch: "ab/ab_stale001" });

    // the re-cut the message promises: no already_active
    await expect(createAbDraft({ projectId: "p1", ownerId: "u1", actorId: "u1", name: "Again" })).resolves.toMatchObject({ status: "draft", targetPath: "/" });
  });

  it("a draft of an experiment that was never cut against anything (no base recorded) is cancelled the same way", async () => {
    await insertExperiment(raw(), { id: "ab_nobase01", status: "draft", copyProjectId: "copy-x", branch: "ab/ab_nobase01", baseCommitOid: null });
    await expect(launch("ab_nobase01")).rejects.toMatchObject({ code: "base_moved" });
    expect((await getExperimentById("ab_nobase01"))!.status).toBe("cancelled");
  });

  it("if the cancel itself fails, the launch still refuses with base_moved", async () => {
    await draft("ab_stale002", "/");
    h.published = { commitOid: "base-2", data: { html: "<html>A2</html>" }, extraFiles: {} };
    h.cleanup.mockRejectedValue(new Error("db"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(launch("ab_stale002")).rejects.toMatchObject({ code: "base_moved", status: 409 });
    error.mockRestore();
  });
});

describe("the base check's backstop (item 17)", () => {
  it("🔴 the same commit but a different published release than at the draft: someone published since — refused", async () => {
    await raw().query(`UPDATE "projects" SET "publishedReleaseSha" = 'release-live-now' WHERE "id" = 'p1'`);
    await insertExperiment(raw(), { id: "ab_sha00001", status: "draft", copyProjectId: "copy-s", branch: "ab/ab_sha00001", baseCommitOid: "base-1", controlReleaseSha: "release-of-the-draft-day" });
    await expect(launch("ab_sha00001")).rejects.toMatchObject({ code: "base_moved", status: 409 });
    expect(h.publishProject).not.toHaveBeenCalled();
    expect((await getExperimentById("ab_sha00001"))!.status).toBe("cancelled");
  });

  it("an identical republish keeps the sha (content-addressed): nothing moved, it launches", async () => {
    await raw().query(`UPDATE "projects" SET "publishedReleaseSha" = 'release-live-now' WHERE "id" = 'p1'`);
    await insertExperiment(raw(), { id: "ab_sha00002", status: "draft", copyProjectId: "copy-s", branch: "ab/ab_sha00002", baseCommitOid: "base-1", controlReleaseSha: "release-live-now" });
    await expect(launch("ab_sha00002")).resolves.toBeDefined();
  });

  it("a project with no recorded release at the draft and none now launches (nothing to compare)", async () => {
    await raw().query(`UPDATE "projects" SET "publishedReleaseSha" = NULL WHERE "id" = 'p1'`);
    await insertExperiment(raw(), { id: "ab_sha00003", status: "draft", copyProjectId: "copy-s", branch: "ab/ab_sha00003", baseCommitOid: "base-1", controlReleaseSha: null });
    await expect(launch("ab_sha00003")).resolves.toBeDefined();
  });
});
