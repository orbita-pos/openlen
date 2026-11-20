// @vitest-environment node
// THE DECISION PATHS, ON A REAL POSTGRES (review items 19 and 20): «Seguir probando» really keeps testing, and the lock a
// decision takes is given back as it was — by the decision that fails, and by the sweep for the one that died.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { insertExperiment, openAbPglite, resetAbRows, type AbPglite } from "./testing/pglite";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  db: null as unknown,
  published: null as Record<string, unknown> | null,
  publishThroughGates: vi.fn(),
  publishProject: vi.fn(),
  rollbackToSha: vi.fn(),
  merge: vi.fn(),
  cleanup: vi.fn(),
  purge: vi.fn(),
  waitForLen: vi.fn(),
  failNextUpdate: false,
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
vi.mock("@/lib/ab/live-manifest", () => ({ readLiveAb: async () => ({ kind: "none", sha: "x" }) }));
vi.mock("@/lib/len-watch/published-sources", () => ({ readPublishedSources: async () => h.published }));
vi.mock("@/lib/projects", () => ({ publishProject: h.publishProject }));
vi.mock("@/lib/projects/publish-through-gates", () => ({ runSecurityGate: vi.fn(), publishThroughGates: h.publishThroughGates }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: h.purge }));
vi.mock("@/lib/publish/filesystem", () => ({ rollbackToSha: h.rollbackToSha }));
vi.mock("@/lib/ab/worktree", () => ({
  cleanupAbWorktree: h.cleanup,
  commitAbWorktree: vi.fn(),
  copySources: vi.fn(),
  createAbWorktree: vi.fn(),
  ensurePublishedSources: async () => h.published,
  mergeWinnerIntoDraft: h.merge,
  readPublishedFolder: async () => ({}),
}));
vi.mock("@/lib/agent/turnos-desde-el-servidor", () => ({ esperarALen: h.waitForLen }));
// The real store, except that the test can make ONE write fail.
vi.mock("@/lib/ab/store", async (orig) => {
  const real = await orig<typeof import("@/lib/ab/store")>();
  return {
    ...real,
    updateExperiment: (...args: Parameters<typeof real.updateExperiment>) => {
      if (h.failNextUpdate) {
        h.failNextUpdate = false;
        return Promise.reject(new Error("the database went away"));
      }
      return real.updateExperiment(...args);
    },
    closeDecision: (...args: Parameters<typeof real.closeDecision>) => {
      if (h.failNextUpdate) {
        h.failNextUpdate = false;
        return Promise.reject(new Error("the database went away"));
      }
      return real.closeDecision(...args);
    },
  };
});

const { discardWinnerBring, extendExperiment, keepControlA, promoteVariantB, retryBringWinner } = await import("./lifecycle");
const { claimExperimentDecision, releaseStaleDecisionLocks, getExperimentById, pendingBringForProject, toExperimentView } = await import("./store");
const { autoStopExperimentForHarm } = await import("./lifecycle");
const { computeExperimentMetrics, metricsInputOf } = await import("./metrics");
const { evaluateAbStats, maxDurationDaysOf } = await import("./stats");

const DAY = 86_400_000;
let pglite: AbPglite;
const raw = (): PGlite => pglite.raw;

beforeAll(async () => {
  pglite = await openAbPglite();
  h.db = pglite.db;
});
afterAll(async () => {
  await raw().close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  h.failNextUpdate = false;
  // clearAllMocks keeps implementations: what one test made fail must not fail the next.
  h.rollbackToSha.mockReset();
  h.rollbackToSha.mockResolvedValue(undefined);
  h.publishProject.mockReset();
  h.publishProject.mockResolvedValue({ sha: "rel-republished" });
  h.merge.mockReset();
  h.purge.mockReset();
  h.purge.mockResolvedValue(undefined);
  h.cleanup.mockResolvedValue(undefined);
  h.waitForLen.mockResolvedValue(false); // Len's turn never ends in a test: the background retry never fires
  h.published = { commitOid: "base-1", data: { html: "<html>A</html>" }, extraFiles: {} };
  await resetAbRows(raw());
});

describe("«Seguir probando» (item 19)", () => {
  it("🔴 clears endedAt and moves THIS experiment's hard stop: what arrives after the old end counts, and 21 days is no longer the end", async () => {
    const now = Date.now();
    const startedAt = new Date(now - 22 * DAY);
    const endedAt = new Date(now - 1 * DAY); // inconclusive at day 21: the window was cut here
    await insertExperiment(raw(), { id: "ab_ext00001", status: "inconclusive", decisionStatus: "pending", startedAt, endedAt, copyProjectId: "copy-1" });
    await raw().query(
      `INSERT INTO "pageEvents" ("id","projectId","type","cid","uaHash","ab","ts") VALUES
        ('e1','p1','view','ca1','h1','ab_ext00001:a',$1), ('e2','p1','view','cb1','h2','ab_ext00001:b',$1),
        ('e3','p1','view','ca2','h3','ab_ext00001:a',$2), ('e4','p1','view','cb2','h4','ab_ext00001:b',$2), ('e5','p1','view','cb3','h5','ab_ext00001:b',$2)`,
      [new Date(now - 10 * DAY), new Date(now - 12 * 3_600_000)],
    );

    const before = (await getExperimentById("ab_ext00001"))!;
    const cut = await computeExperimentMetrics(metricsInputOf({ ...before, startedAt: before.startedAt! }), new Date(now));
    expect(cut.a.views + cut.b.views).toBe(2); // the window ends at endedAt
    expect(evaluateAbStats({ viewsA: 1, conversionsA: 0, viewsB: 1, conversionsB: 0, splitBps: 5000, durationHours: 22 * 24, maxDurationDays: maxDurationDaysOf(before) }).verdict).toBe("inconclusive");

    const view = await extendExperiment({ projectId: "p1", experimentId: "ab_ext00001", actorId: "u1", extraDays: 7 });

    const after = (await getExperimentById("ab_ext00001"))!;
    expect(view.status).toBe("running");
    expect(after.status).toBe("running");
    expect(after.decisionStatus).toBe("none");
    expect(after.endedAt).toBeNull();
    expect(after.winnerVariant).toBeNull();
    // Its own hard stop: seven days from now, not day 21 of a run that is already on day 22.
    expect(after.maxEndAt!.getTime()).toBeGreaterThan(now + 6.9 * DAY);
    expect(after.maxEndAt!.getTime()).toBeLessThan(now + 7.1 * DAY);
    expect(maxDurationDaysOf(after)).toBeGreaterThan(28.9);

    const open = await computeExperimentMetrics(metricsInputOf({ ...after, startedAt: after.startedAt! }), new Date(now));
    expect(open.a.views + open.b.views).toBe(5); // the three that arrived AFTER the old end are in
    expect(evaluateAbStats({ viewsA: 2, conversionsA: 0, viewsB: 3, conversionsB: 0, splitBps: 5000, durationHours: 22 * 24, maxDurationDays: maxDurationDaysOf(after) }).verdict).toBe("collecting");
  });

  it("extending early never SHORTENS the hard stop (a winner found on day 5 keeps day 21 as its limit)", async () => {
    const now = Date.now();
    await insertExperiment(raw(), { id: "ab_ext00002", status: "winner_ready", decisionStatus: "pending", startedAt: new Date(now - 5 * DAY), endedAt: new Date(now - 1 * DAY), winnerVariant: "b" });
    await extendExperiment({ projectId: "p1", experimentId: "ab_ext00002", actorId: "u1", extraDays: 7 });
    const after = (await getExperimentById("ab_ext00002"))!;
    expect(maxDurationDaysOf(after)).toBe(21);
    expect(after.snoozeUntil!.getTime()).toBeGreaterThan(now + 6.9 * DAY);
  });

  it("an experiment that was never extended keeps the global default", async () => {
    const row = await (async () => {
      await insertExperiment(raw(), { id: "ab_ext00003", startedAt: new Date() });
      return (await getExperimentById("ab_ext00003"))!;
    })();
    expect(row.maxEndAt).toBeNull();
    expect(maxDurationDaysOf(row)).toBe(21);
  });
});

describe("the decision lock (item 20)", () => {
  it("🔴 the claim remembers what the decision status was: pending stays pending, none stays none", async () => {
    await insertExperiment(raw(), { id: "ab_lock0001", status: "winner_ready", decisionStatus: "pending" });
    await insertExperiment(raw(), { id: "ab_lock0002", projectId: "p2", status: "running", decisionStatus: "none" });
    const a = await claimExperimentDecision("ab_lock0001", "p1");
    const b = await claimExperimentDecision("ab_lock0002", "p2");
    expect(a).toMatchObject({ decisionStatus: "applying", decisionPrevStatus: "pending" });
    expect(b).toMatchObject({ decisionStatus: "applying", decisionPrevStatus: "none" });
    expect(a!.decisionLockedAt).toBeInstanceOf(Date);
  });

  it("🔴 a promote that fails gives the decision back as PENDING (the card and the summary keep showing it)", async () => {
    await insertExperiment(raw(), { id: "ab_lock0003", status: "winner_ready", decisionStatus: "pending", copyProjectId: "copy-1", winnerVariant: "b" });
    h.publishThroughGates.mockResolvedValue({ status: 500, body: { error: "boom" } });
    await expect(promoteVariantB({ projectId: "p1", experimentId: "ab_lock0003", ownerId: "u1", actorId: "u1" })).rejects.toMatchObject({ code: "security_blocked" });
    const row = (await getExperimentById("ab_lock0003"))!;
    expect(row.decisionStatus).toBe("pending");
    expect(row.decisionPrevStatus).toBeNull();
    expect(row.decisionLockedAt).toBeNull();
    expect(row.status).toBe("winner_ready");
  });

  it("an owner who decided EARLY (decision none, still running) gets none back when it fails", async () => {
    await insertExperiment(raw(), { id: "ab_lock0004", status: "running", decisionStatus: "none", copyProjectId: "copy-1", startedAt: new Date() });
    h.publishThroughGates.mockRejectedValue(new Error("disk full"));
    await expect(promoteVariantB({ projectId: "p1", experimentId: "ab_lock0004", ownerId: "u1", actorId: "u1" })).rejects.toThrow(/disk full/);
    expect((await getExperimentById("ab_lock0004"))!.decisionStatus).toBe("none");
  });

  it("🔴 keep-A and «Seguir probando» that fail give the decision back as it was too", async () => {
    await insertExperiment(raw(), { id: "ab_lock0005", status: "inconclusive", decisionStatus: "pending", controlReleaseSha: "rel-c", startedAt: new Date(Date.now() - 3 * DAY) });
    h.rollbackToSha.mockRejectedValue(new Error("pruned"));
    h.publishProject.mockRejectedValue(new Error("republish failed"));
    await expect(keepControlA({ projectId: "p1", experimentId: "ab_lock0005", ownerId: "u1", actorId: "u1" })).rejects.toThrow(/republish failed/);
    expect((await getExperimentById("ab_lock0005"))!.decisionStatus).toBe("pending");

    h.failNextUpdate = true;
    await expect(extendExperiment({ projectId: "p1", experimentId: "ab_lock0005", actorId: "u1" })).rejects.toThrow(/went away/);
    const row = (await getExperimentById("ab_lock0005"))!;
    expect(row.decisionStatus).toBe("pending");
    expect(row.status).toBe("inconclusive");
  });

  it("🔴 stale-lock sweep: an `applying` older than 10 minutes goes back to its previous status; a fresh one is left alone", async () => {
    const now = new Date();
    await insertExperiment(raw(), { id: "ab_stale001", status: "winner_ready", decisionStatus: "applying", decisionPrevStatus: "pending", decisionLockedAt: new Date(now.getTime() - 11 * 60_000) });
    await insertExperiment(raw(), { id: "ab_stale002", status: "running", decisionStatus: "applying", decisionPrevStatus: "none", decisionLockedAt: new Date(now.getTime() - 11 * 60_000), startedAt: new Date(), projectId: "p2" });
    await insertExperiment(raw(), { id: "ab_fresh001", status: "winner_ready", decisionStatus: "applying", decisionPrevStatus: "pending", decisionLockedAt: new Date(now.getTime() - 2 * 60_000), projectId: "p3" });
    // A lock from before the column existed: dated by the last write.
    await insertExperiment(raw(), { id: "ab_stale003", status: "winner_ready", decisionStatus: "applying", updatedAt: new Date(now.getTime() - 30 * 60_000), projectId: "p4" });

    const released = await releaseStaleDecisionLocks(now);
    expect([...released].sort()).toEqual(["ab_stale001", "ab_stale002", "ab_stale003"]);
    expect((await getExperimentById("ab_stale001"))).toMatchObject({ decisionStatus: "pending", decisionPrevStatus: null, decisionLockedAt: null });
    expect((await getExperimentById("ab_stale002"))!.decisionStatus).toBe("none");
    expect((await getExperimentById("ab_stale003"))!.decisionStatus).toBe("pending"); // no memory: derived from its status
    expect((await getExperimentById("ab_fresh001"))!.decisionStatus).toBe("applying");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A PROMOTED WINNER THAT DOESN'T FIT THE DRAFT (review item 26). B is live the moment the publish went through: that is
// recorded first, and bringing it into the owner's draft — which can clash, or wait for Len — never undoes it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const winnerReady = (id: string, o: Record<string, unknown> = {}) =>
  insertExperiment(raw(), {
    id,
    status: "winner_ready",
    decisionStatus: "pending",
    winnerVariant: "b",
    copyProjectId: "copy-1",
    branch: `ab/${id}`,
    baseCommitOid: "base-1",
    startedAt: new Date(Date.now() - 4 * DAY),
    ...o,
  });
const promote = (id: string) => promoteVariantB({ projectId: "p1", experimentId: id, ownerId: "u1", actorId: "u1" });

describe("promote, then bring into the draft (item 26)", () => {
  beforeEach(() => {
    h.publishThroughGates.mockResolvedValue({ status: 200, body: { sha: "rel-promoted" } });
  });

  it("a clean merge: promoted, brought, the copy AND the branch are deleted, nothing waits", async () => {
    await winnerReady("ab_prom0001");
    h.merge.mockResolvedValue({ kind: "brought" });
    const r = await promote("ab_prom0001");
    expect(r.bringState).toBe("brought");
    expect(await getExperimentById("ab_prom0001")).toMatchObject({ status: "promoted_b", decisionStatus: "resolved", bringState: "brought", copyProjectId: null, promotedReleaseSha: "rel-promoted" });
    expect(h.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: "copy-1", branch: "ab/ab_prom0001" });
    expect(await pendingBringForProject("p1")).toBeNull();
  });

  it("🔴 a conflict: the experiment records bringState conflict, keeps its branch, and the owner's next publish is held", async () => {
    await winnerReady("ab_prom0002");
    h.merge.mockResolvedValue({ kind: "conflict", paths: ["/index.html"] });
    const r = await promote("ab_prom0002");
    expect(r).toMatchObject({ bringState: "conflict", conflictPaths: ["/index.html"] });
    expect(await getExperimentById("ab_prom0002")).toMatchObject({ status: "promoted_b", bringState: "conflict", copyProjectId: null, branch: "ab/ab_prom0002" });
    // the copy goes, the branch stays (Len or the owner finishes it)
    expect(h.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: "copy-1", branch: null });
    expect((await pendingBringForProject("p1"))?.id).toBe("ab_prom0002");
  });

  it("🔴 a Len turn is live: the merge isn't tried, the winner is recorded as pending, and a retry is scheduled for when the turn ends", async () => {
    await winnerReady("ab_prom0003");
    h.merge.mockResolvedValue({ kind: "busy" });
    const r = await promote("ab_prom0003");
    expect(r.bringState).toBe("pending");
    expect(await getExperimentById("ab_prom0003")).toMatchObject({ status: "promoted_b", bringState: "pending" });
    expect((await pendingBringForProject("p1"))?.id).toBe("ab_prom0003");
    await vi.waitFor(() => expect(h.waitForLen).toHaveBeenCalledWith("p1"));
  });

  it("🔴 a merge that THROWS doesn't undo the promotion: B is live, the decision stands, the bring stays pending", async () => {
    await winnerReady("ab_prom0004");
    h.merge.mockRejectedValue(new Error("guard exploded"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await promote("ab_prom0004");
    error.mockRestore();
    expect(r.bringState).toBe("pending");
    expect(await getExperimentById("ab_prom0004")).toMatchObject({ status: "promoted_b", decisionStatus: "resolved", bringState: "pending", decisionPrevStatus: null });
  });

  it("a publish that fails records nothing: the experiment is still a decision waiting", async () => {
    await winnerReady("ab_prom0005");
    h.publishThroughGates.mockResolvedValue({ status: 428, body: { error: "security_findings" } });
    await expect(promote("ab_prom0005")).rejects.toMatchObject({ code: "security_blocked" });
    expect(await getExperimentById("ab_prom0005")).toMatchObject({ status: "winner_ready", decisionStatus: "pending", bringState: null });
    expect(h.merge).not.toHaveBeenCalled();
  });
});

describe("«Bring into draft» and «Don't bring it in» (item 26)", () => {
  const conflicted = (id: string, o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), { id, status: "promoted_b", decisionStatus: "resolved", winnerVariant: "b", bringState: "conflict", branch: `ab/${id}`, baseCommitOid: "base-1", ...o });
  const bring = (id: string) => retryBringWinner({ projectId: "p1", experimentId: id, ownerId: "u1", actorId: "u1" });

  it("🔴 bring refuses anything that isn't a PROMOTED winner with an open bring", async () => {
    await insertExperiment(raw(), { id: "ab_ring0001", status: "running", branch: "ab/ab_ring0001", baseCommitOid: "base-1", startedAt: new Date() });
    await expect(bring("ab_ring0001")).rejects.toMatchObject({ code: "invalid_state", status: 409 });
    await insertExperiment(raw(), { id: "ab_ring0002", projectId: "p2", status: "promoted_b", decisionStatus: "resolved", bringState: "brought", branch: "ab/ab_ring0002", baseCommitOid: "base-1" });
    await expect(retryBringWinner({ projectId: "p2", experimentId: "ab_ring0002", ownerId: "u1", actorId: "u1" })).rejects.toMatchObject({ code: "invalid_state", status: 409 });
    expect(h.merge).not.toHaveBeenCalled();
  });

  it("a retry that now merges cleanly brings it in, deletes the branch and releases the publish", async () => {
    await conflicted("ab_ring0003");
    h.merge.mockResolvedValue({ kind: "brought" });
    await expect(bring("ab_ring0003")).resolves.toEqual({ status: "brought" });
    expect(await getExperimentById("ab_ring0003")).toMatchObject({ bringState: "brought" });
    expect(h.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: null, branch: "ab/ab_ring0003" });
    expect(await pendingBringForProject("p1")).toBeNull();
  });

  it("a retry that still clashes stays a conflict; one that meets a live Len turn is queued", async () => {
    await conflicted("ab_ring0004");
    h.merge.mockResolvedValueOnce({ kind: "conflict", paths: ["/a.css"] });
    await expect(bring("ab_ring0004")).resolves.toEqual({ status: "conflict", paths: ["/a.css"] });
    h.merge.mockResolvedValueOnce({ kind: "busy" });
    await expect(bring("ab_ring0004")).resolves.toEqual({ status: "queued" });
    expect((await getExperimentById("ab_ring0004"))!.bringState).toBe("conflict");
  });

  it("🔴 discard: the branch is deleted, production isn't touched, and the owner's publish no longer waits", async () => {
    await conflicted("ab_ring0005");
    expect((await pendingBringForProject("p1"))?.id).toBe("ab_ring0005");
    const view = await discardWinnerBring({ projectId: "p1", experimentId: "ab_ring0005" });
    expect(view.bringState).toBe("declined");
    expect(h.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: null, branch: "ab/ab_ring0005" });
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(h.publishThroughGates).not.toHaveBeenCalled();
    expect(h.rollbackToSha).not.toHaveBeenCalled();
    expect(await getExperimentById("ab_ring0005")).toMatchObject({ status: "promoted_b", bringState: "declined" });
    expect(await pendingBringForProject("p1")).toBeNull();
    // and it can't be brought any more
    await expect(bring("ab_ring0005")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("discard refuses what isn't a promoted winner with an open bring", async () => {
    await insertExperiment(raw(), { id: "ab_ring0006", status: "winner_ready", decisionStatus: "pending", startedAt: new Date() });
    await expect(discardWinnerBring({ projectId: "p1", experimentId: "ab_ring0006" })).rejects.toMatchObject({ code: "invalid_state" });
    await insertExperiment(raw(), { id: "ab_ring0007", projectId: "p2", status: "promoted_b", decisionStatus: "resolved", bringState: "brought" });
    await expect(discardWinnerBring({ projectId: "p2", experimentId: "ab_ring0007" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(discardWinnerBring({ projectId: "p1", experimentId: "ab_nope0000" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("promote's own tail claims the bring too (round 3, E)", () => {
  beforeEach(() => {
    h.publishThroughGates.mockResolvedValue({ status: 200, body: { sha: "rel-promoted" } });
  });

  it("🔴 a discard that lands BEFORE the tail's merge wins: nothing is merged into the declined draft, and nothing waits for Len", async () => {
    await winnerReady("ab_tail0001");
    // the tail starts with the edge purge: the dialog's «Don't bring it in» arrives right there
    h.purge.mockImplementationOnce(async () => {
      await discardWinnerBring({ projectId: "p1", experimentId: "ab_tail0001" });
    });
    const r = await promote("ab_tail0001");
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.waitForLen).not.toHaveBeenCalled();
    expect(await getExperimentById("ab_tail0001")).toMatchObject({ status: "promoted_b", bringState: "declined" });
    expect(r.experiment.bringState).toBe("declined");
  });

  it("🔴 a discard that arrives DURING the tail's merge is refused, and the bring ends brought", async () => {
    await winnerReady("ab_tail0002");
    let during: unknown;
    h.merge.mockImplementation(async () => {
      during = await discardWinnerBring({ projectId: "p1", experimentId: "ab_tail0002" }).catch((e: unknown) => e);
      return { kind: "brought" };
    });
    const r = await promote("ab_tail0002");
    expect(during).toMatchObject({ code: "invalid_state", status: 409 });
    expect(r.bringState).toBe("brought");
    expect(await getExperimentById("ab_tail0002")).toMatchObject({ bringState: "brought" });
  });

  it("a merge that meets a live Len turn, or throws, puts the row back as a waiting bring (never stuck on «bringing»)", async () => {
    await winnerReady("ab_tail0003");
    h.merge.mockResolvedValue({ kind: "busy" });
    await promote("ab_tail0003");
    expect((await getExperimentById("ab_tail0003"))!.bringState).toBe("pending");
    await vi.waitFor(() => expect(h.waitForLen).toHaveBeenCalledWith("p1"));

    await winnerReady("ab_tail0004", { projectId: "p2" });
    h.merge.mockRejectedValue(new Error("guard exploded"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await promoteVariantB({ projectId: "p2", experimentId: "ab_tail0004", ownerId: "u1", actorId: "u1" });
    error.mockRestore();
    expect(r.bringState).toBe("pending");
    expect((await getExperimentById("ab_tail0004"))!.bringState).toBe("pending");
  });
});

describe("a re-emit that swaps a split over a decision that closed during it (round 3, B)", () => {
  it("🔴 the keep A closed while the re-emit was publishing: the re-emit's record misses, and the split comes down right away", async () => {
    await insertExperiment(raw(), { id: "ab_swap0001", status: "kept_a", decisionStatus: "resolved", startedAt: new Date(Date.now() - 4 * DAY), endedAt: new Date(), controlReleaseSha: "rel-c" });
    const { recordAndPurgeReemit } = await import("./reemit");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAndPurgeReemit({ id: "ab_swap0001", targetPath: "/", includeLocales: false }, "pan1", { sha: "rel-reemit", abOverrides: ["/css/b.css"] }, [], "u1");
    error.mockRestore();
    expect(h.publishProject).toHaveBeenCalledTimes(1);
    expect(h.publishProject.mock.calls[0]![0]).toMatchObject({ projectId: "p1", subdomain: "pan1" });
    expect(h.publishProject.mock.calls[0]![0]).not.toHaveProperty("abExperiment");
    expect(h.publishProject.mock.calls[0]![0]).not.toHaveProperty("abLive"); // the bottom door stays on (round 4, F)
    // the row is what the decision made it
    expect(await getExperimentById("ab_swap0001")).toMatchObject({ status: "kept_a" });
  });
});

describe("a bring and a discard racing (review of G4+G5, minor 10)", () => {
  const open = (id: string, state = "pending", o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), { id, status: "promoted_b", decisionStatus: "resolved", winnerVariant: "b", bringState: state, branch: `ab/${id}`, baseCommitOid: "base-1", ...o });
  const bring = (id: string) => retryBringWinner({ projectId: "p1", experimentId: id, ownerId: "u1", actorId: "u1" });
  const discard = (id: string) => discardWinnerBring({ projectId: "p1", experimentId: id });

  it("🔴 the bring CLAIMS the row before it merges: a discard that arrives meanwhile is refused, and B is never merged into a draft whose bring was declined", async () => {
    await open("ab_race0001");
    let during: unknown;
    h.merge.mockImplementation(async () => {
      during = await discard("ab_race0001").catch((e: unknown) => e);
      return { kind: "brought" };
    });
    await expect(bring("ab_race0001")).resolves.toEqual({ status: "brought" });
    expect(during).toMatchObject({ code: "invalid_state", status: 409 });
    expect(await getExperimentById("ab_race0001")).toMatchObject({ bringState: "brought" });
  });

  it("🔴 a discard that comes FIRST wins cleanly: the bring is refused and nothing is merged", async () => {
    await open("ab_race0002", "conflict");
    await discard("ab_race0002");
    await expect(bring("ab_race0002")).rejects.toMatchObject({ code: "invalid_state", status: 409 });
    expect(h.merge).not.toHaveBeenCalled();
    expect(await getExperimentById("ab_race0002")).toMatchObject({ bringState: "declined" });
  });

  it("two brings at once: one merges, the other is refused", async () => {
    await open("ab_race0003");
    h.merge.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { kind: "brought" };
    });
    const results = await Promise.allSettled([bring("ab_race0003"), bring("ab_race0003")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(h.merge).toHaveBeenCalledTimes(1);
  });

  it("🔴 while it is being brought the owner's publish still waits (the gate sees it), and clients are told «pending»", async () => {
    await open("ab_race0004");
    let gate: Awaited<ReturnType<typeof pendingBringForProject>> = null;
    h.merge.mockImplementation(async () => {
      gate = await pendingBringForProject("p1");
      return { kind: "brought" };
    });
    await bring("ab_race0004");
    expect(gate).toMatchObject({ id: "ab_race0004", bringState: "bringing" });
    expect(toExperimentView(gate!).bringState).toBe("pending");
  });

  it("🔴 a merge that throws, or meets a live Len turn, or clashes, never leaves the row on «bringing»", async () => {
    await open("ab_race0005");
    h.merge.mockRejectedValueOnce(new Error("the database went away"));
    await expect(bring("ab_race0005")).rejects.toThrow("the database went away");
    expect((await getExperimentById("ab_race0005"))!.bringState).toBe("pending");
    h.merge.mockResolvedValueOnce({ kind: "busy" });
    await expect(bring("ab_race0005")).resolves.toEqual({ status: "queued" });
    expect((await getExperimentById("ab_race0005"))!.bringState).toBe("pending");
    h.merge.mockResolvedValueOnce({ kind: "conflict", paths: ["/a.css"] });
    await expect(bring("ab_race0005")).resolves.toEqual({ status: "conflict", paths: ["/a.css"] });
    expect((await getExperimentById("ab_race0005"))!.bringState).toBe("conflict");
  });

  it("a «bringing» left by a process that died is reclaimed after ten minutes; a fresh one is somebody else's work", async () => {
    await open("ab_race0006", "bringing", { updatedAt: new Date(Date.now() - 3 * 60_000) });
    await expect(bring("ab_race0006")).rejects.toMatchObject({ code: "invalid_state", status: 409 });
    expect(h.merge).not.toHaveBeenCalled();
    await open("ab_race0007", "bringing", { projectId: "p2", updatedAt: new Date(Date.now() - 11 * 60_000) });
    h.merge.mockResolvedValue({ kind: "brought" });
    await expect(retryBringWinner({ projectId: "p2", experimentId: "ab_race0007", ownerId: "u1", actorId: "u1" })).resolves.toEqual({ status: "brought" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE WAY BACK TO CONTROL (G1+G3 review, item 20): rolling back to the release saved at launch is only right while the live
// release is the experiment's. If something else was published since (the live release isn't the experiment's), going back
// to the saved one would undo it: the published SOURCES are republished instead.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("keep-A goes back by rollback only when nothing was published since (item 20)", () => {
  const setLive = (sha: string) => raw().query(`UPDATE "projects" SET "publishedReleaseSha" = $1 WHERE "id" = 'p1'`, [sha]);
  const liveWithFallback = (id: string) =>
    insertExperiment(raw(), { id, status: "winner_ready", decisionStatus: "pending", controlReleaseSha: "rel-c", startedAt: new Date(Date.now() - 4 * DAY), copyProjectId: "copy-1", branch: `ab/${id}` });
  const withExperimentRelease = (id: string, sha: string) => raw().query(`UPDATE "abExperiments" SET "experimentReleaseSha" = $1 WHERE "id" = $2`, [sha, id]);

  it("🔴 the live release is the experiment's: the rollback to Control's saved release, as before", async () => {
    await liveWithFallback("ab_back0001");
    await withExperimentRelease("ab_back0001", "rel-x");
    await setLive("rel-x");
    await keepControlA({ projectId: "p1", experimentId: "ab_back0001", ownerId: "u1", actorId: "u1" });
    expect(h.rollbackToSha).toHaveBeenCalledWith("pan1", "rel-c");
    expect(h.publishProject).not.toHaveBeenCalled();
  });

  it("🔴 something else was published since: NO rollback over it — the published sources are republished", async () => {
    await liveWithFallback("ab_back0002");
    await withExperimentRelease("ab_back0002", "rel-x");
    await setLive("rel-published-since");
    h.published = { commitOid: "base-1", data: { html: "<html>PUBLISHED</html>" }, extraFiles: {} };
    h.publishProject.mockResolvedValue({ sha: "rel-new" });
    await keepControlA({ projectId: "p1", experimentId: "ab_back0002", ownerId: "u1", actorId: "u1" });
    expect(h.rollbackToSha).not.toHaveBeenCalled();
    expect(h.publishProject).toHaveBeenCalledWith(expect.objectContaining({ abLive: "ending" }));
    expect((await getExperimentById("ab_back0002"))!.status).toBe("kept_a");
  });

  it("an experiment that never recorded its release can't be compared: the rollback goes ahead, as before", async () => {
    await liveWithFallback("ab_back0003");
    await setLive("anything");
    await keepControlA({ projectId: "p1", experimentId: "ab_back0003", ownerId: "u1", actorId: "u1" });
    expect(h.rollbackToSha).toHaveBeenCalledWith("pan1", "rel-c");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY END PURGES THE EDGE (edge review, item 24): promote, keep A, harm stop — the target page, its languages when the
// experiment covers them, and every asset B overrode, through the existing purge helper.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("every end of an experiment purges the edge (item 24)", () => {
  const live = (id: string, o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), { id, status: "winner_ready", decisionStatus: "pending", targetPath: "/pricing", controlReleaseSha: "rel-c", copyProjectId: "copy-1", branch: `ab/${id}`, baseCommitOid: "base-1", startedAt: new Date(Date.now() - 4 * DAY), ...o });
  const withOverrides = (id: string) =>
    raw().query(`UPDATE "abExperiments" SET "overridePaths" = '["/css/site.css","/js/hero.js"]'::jsonb, "includeLocales" = true WHERE "id" = $1`, [id]);
  const withLanguages = () => raw().query(`UPDATE "projects" SET "data" = '{"html":"<html>A</html>","settings":{"languages":["es","fr"]}}'::jsonb WHERE "id" = 'p1'`);
  const EXPECTED = ["/pricing", "/pricing/", "/pricing/index.html", "/es/pricing", "/es/pricing/", "/es/pricing/index.html", "/fr/pricing", "/fr/pricing/", "/fr/pricing/index.html", "/css/site.css", "/js/hero.js"];

  it("🔴 keep A by rollback", async () => {
    await live("ab_end00001");
    await withOverrides("ab_end00001");
    await withLanguages();
    await keepControlA({ projectId: "p1", experimentId: "ab_end00001", ownerId: "u1", actorId: "u1" });
    expect(h.rollbackToSha).toHaveBeenCalled();
    expect(h.purge).toHaveBeenCalledWith("pan1", EXPECTED);
  });

  it("🔴 keep A by republishing the published sources (no fallback release)", async () => {
    await live("ab_end00002", { controlReleaseSha: null });
    await withOverrides("ab_end00002");
    await withLanguages();
    h.published = { commitOid: "base-1", data: { html: "<html>PUBLISHED</html>" }, extraFiles: {} };
    await keepControlA({ projectId: "p1", experimentId: "ab_end00002", ownerId: "u1", actorId: "u1" });
    expect(h.publishProject).toHaveBeenCalled();
    expect(h.purge).toHaveBeenCalledWith("pan1", EXPECTED);
  });

  it("🔴 promote B", async () => {
    await live("ab_end00003");
    await withOverrides("ab_end00003");
    await withLanguages();
    h.publishThroughGates.mockResolvedValue({ status: 200, body: { sha: "rel-promoted" } });
    h.merge.mockResolvedValue({ kind: "brought" });
    await promoteVariantB({ projectId: "p1", experimentId: "ab_end00003", ownerId: "u1", actorId: "u1" });
    expect(h.purge).toHaveBeenCalledWith("pan1", EXPECTED);
  });

  it("an experiment that doesn't cover languages purges its page and assets only", async () => {
    await live("ab_end00004");
    await raw().query(`UPDATE "abExperiments" SET "overridePaths" = '["/css/site.css"]'::jsonb WHERE "id" = 'ab_end00004'`);
    await withLanguages();
    await keepControlA({ projectId: "p1", experimentId: "ab_end00004", ownerId: "u1", actorId: "u1" });
    expect(h.purge).toHaveBeenCalledWith("pan1", ["/pricing", "/pricing/", "/pricing/index.html", "/css/site.css"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FENCING, ON REAL DECISIONS (review: stale-lock recovery), and the ends that must record before they clean up.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("a decision whose lock was taken over writes nothing (review: stale-lock recovery)", () => {
  const live = (id: string, o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), { id, status: "winner_ready", decisionStatus: "pending", controlReleaseSha: "rel-c", copyProjectId: "copy-1", branch: `ab/${id}`, baseCommitOid: "base-1", startedAt: new Date(Date.now() - 4 * DAY), ...o });

  it("🔴 keep A: its publish is slow, the sweep gives the lock away and another decision takes it; the close misses and overwrites nothing", async () => {
    await live("ab_fenc0001");
    let second: string | null = null;
    h.rollbackToSha.mockImplementation(async () => {
      await raw().query(`UPDATE "abExperiments" SET "decisionLockedAt" = now() - interval '20 minutes' WHERE "id" = 'ab_fenc0001'`);
      await releaseStaleDecisionLocks();
      second = (await claimExperimentDecision("ab_fenc0001", "p1"))!.decisionLockToken;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(keepControlA({ projectId: "p1", experimentId: "ab_fenc0001", ownerId: "u1", actorId: "u1" })).rejects.toMatchObject({ code: "decision_conflict" });
    error.mockRestore();
    const row = (await getExperimentById("ab_fenc0001"))!;
    expect(row).toMatchObject({ status: "winner_ready", decisionStatus: "applying", decisionLockToken: second });
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it("🔴 promote: B went live but the lock was taken over before the record: nothing is overwritten, and it says so", async () => {
    await live("ab_fenc0002");
    h.publishThroughGates.mockImplementation(async () => {
      await raw().query(`UPDATE "abExperiments" SET "decisionLockedAt" = now() - interval '20 minutes' WHERE "id" = 'ab_fenc0002'`);
      await releaseStaleDecisionLocks();
      await claimExperimentDecision("ab_fenc0002", "p1");
      return { status: 200, body: { sha: "rel-promoted" } };
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(promoteVariantB({ projectId: "p1", experimentId: "ab_fenc0002", ownerId: "u1", actorId: "u1" })).rejects.toMatchObject({ code: "decision_conflict" });
    error.mockRestore();
    expect(await getExperimentById("ab_fenc0002")).toMatchObject({ status: "winner_ready", decisionStatus: "applying", promotedReleaseSha: null });
    expect(h.merge).not.toHaveBeenCalled();
  });

  it("🔴 a launch that hasn't finished (running, no start) can't be decided by anybody", async () => {
    await insertExperiment(raw(), { id: "ab_fenc0003", status: "running", startedAt: null });
    await expect(keepControlA({ projectId: "p1", experimentId: "ab_fenc0003", ownerId: "u1", actorId: "u1" })).rejects.toMatchObject({ code: "decision_conflict" });
    await expect(extendExperiment({ projectId: "p1", experimentId: "ab_fenc0003", actorId: "u1" })).rejects.toMatchObject({ code: "decision_conflict" });
    expect(h.rollbackToSha).not.toHaveBeenCalled();
  });
});

describe("the ends record first and clean up after (review minors 6 and 7)", () => {
  const live = (id: string, o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), { id, status: "winner_ready", decisionStatus: "pending", controlReleaseSha: "rel-c", copyProjectId: "copy-1", branch: `ab/${id}`, baseCommitOid: "base-1", startedAt: new Date(Date.now() - 4 * DAY), ...o });

  it("🔴 keep A that can't restore Control (nothing to restore it from) is NOT «kept»: the split is live — it fails and the decision stays", async () => {
    await live("ab_rec00001", { controlReleaseSha: null });
    h.published = null;
    await expect(keepControlA({ projectId: "p1", experimentId: "ab_rec00001", ownerId: "u1", actorId: "u1" })).rejects.toMatchObject({ code: "invalid_state" });
    expect(await getExperimentById("ab_rec00001")).toMatchObject({ status: "winner_ready", decisionStatus: "pending", decisionLockToken: null });
  });

  it("🔴 keep A: a cleanup that throws AFTER Control was restored doesn't undo the end", async () => {
    await live("ab_rec00002");
    h.cleanup.mockRejectedValue(new Error("git store down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await keepControlA({ projectId: "p1", experimentId: "ab_rec00002", ownerId: "u1", actorId: "u1" });
    error.mockRestore();
    expect(view.status).toBe("kept_a");
    expect(await getExperimentById("ab_rec00002")).toMatchObject({ status: "kept_a", decisionStatus: "resolved", copyProjectId: null });
  });

  it("🔴 the harm stop: the same — recorded, then cleaned up best-effort", async () => {
    await live("ab_rec00003", { status: "running", decisionStatus: "none" });
    h.cleanup.mockRejectedValue(new Error("git store down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = (await getExperimentById("ab_rec00003"))!;
    const out = await autoStopExperimentForHarm(row, "u1", "pan1", { a: {}, b: {}, stats: { verdict: "harm_stop" } } as never, new Date());
    error.mockRestore();
    expect(out).toEqual({ restored: true });
    expect(await getExperimentById("ab_rec00003")).toMatchObject({ status: "paused_harm", decisionStatus: "resolved", copyProjectId: null });
  });

  it("🔴 promote: a cleanup error while settling the bring doesn't turn a successful promotion into an error", async () => {
    await live("ab_rec00004");
    h.publishThroughGates.mockResolvedValue({ status: 200, body: { sha: "rel-promoted" } });
    h.merge.mockResolvedValue({ kind: "brought" });
    h.cleanup.mockRejectedValue(new Error("git store down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await promoteVariantB({ projectId: "p1", experimentId: "ab_rec00004", ownerId: "u1", actorId: "u1" });
    error.mockRestore();
    expect(out.experiment.status).toBe("promoted_b");
    expect((await getExperimentById("ab_rec00004"))!.status).toBe("promoted_b");
  });
});
