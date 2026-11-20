// @vitest-environment node
// THE RECONCILE PASS, ON A REAL POSTGRES (review of G4+G5, ruling 5). The database row and the live release can disagree — a
// launch that died between the swap and its write, an owner's «Stop and publish» whose close failed, a promote whose
// recording failed after B went live — and the release is what the edge serves, so the pass reads it before the evaluator
// judges anything: a started experiment whose release doesn't carry its split is closed; a launch that never finished is settled
// from what the release says; a promote whose recording was lost is recorded. It never guesses (an unreadable release changes
// nothing), never touches a decision being applied, and every write is a compare-and-swap.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { insertExperiment, openAbPglite, resetAbRows, type AbPglite } from "./testing/pglite";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  db: null as unknown,
  live: vi.fn(),
  tell: vi.fn(),
  purge: vi.fn(),
  cleanup: vi.fn(),
  merge: vi.fn(),
  publishProject: vi.fn(),
  published: null as Record<string, unknown> | null,
  filesAt: vi.fn(),
  copy: vi.fn(),
  tip: vi.fn(),
  waitForLen: vi.fn(),
  noSubdomain: false,
  rollback: vi.fn(),
}));

vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/ab/live-manifest", () => ({ readLiveAb: (...args: unknown[]) => h.live(...args) }));
vi.mock("@/lib/len-watch/published-sources", async (orig) => ({
  ...(await orig<typeof import("@/lib/len-watch/published-sources")>()),
  readPublishedSources: async () => h.published,
}));
vi.mock("@/lib/len-watch/worktree", () => ({ branchTip: (...args: unknown[]) => h.tip(...args) }));
vi.mock("@/lib/projects", () => ({ publishProject: h.publishProject }));
vi.mock("@/lib/projects/publish-through-gates", () => ({ runSecurityGate: vi.fn(), publishThroughGates: vi.fn() }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: h.purge }));
vi.mock("@/lib/publish/filesystem", () => ({ rollbackToSha: (...args: unknown[]) => h.rollback(...args) }));
vi.mock("@/lib/ab/worktree", () => ({
  cleanupAbWorktree: h.cleanup,
  commitAbWorktree: vi.fn(),
  copySources: (...args: unknown[]) => h.copy(...args),
  createAbWorktree: vi.fn(),
  ensurePublishedSources: async () => h.published,
  mergeWinnerIntoDraft: h.merge,
  readFilesAtCommit: (...args: unknown[]) => h.filesAt(...args),
  readPublishedFolder: async () => ({}),
}));
vi.mock("@/lib/agent/turnos-desde-el-servidor", () => ({ esperarALen: h.waitForLen }));

const { reconcileLiveExperiments, defaultReconcileDeps, LAUNCH_CLAIM_STALE_MS, SYSTEM_ACTOR } = await import("./reconcile");
const { claimExperimentDecision, getExperimentById } = await import("./store");

const NOW = new Date("2026-11-19T14:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
let pglite: AbPglite;
const raw = (): PGlite => pglite.raw;

const info = async (projectId: string) => ({
  id: projectId,
  ownerId: "u1",
  title: "Panadería",
  subdomain: h.noSubdomain ? null : `pan${projectId.slice(1)}`,
  locale: "en",
  assistant: null,
});
const run = () => reconcileLiveExperiments(defaultReconcileDeps({ projectInfo: info, tell: async (...args) => void (await h.tell(...args)) }), NOW);

/** Variant B's files, as the copy has them and as the published commit has them once B went live. */
const B_FILES = { "/index.html": "<html>B</html>" };
const A_FILES = { "/index.html": "<html>A</html>" };

beforeAll(async () => {
  pglite = await openAbPglite();
  h.db = pglite.db;
});
afterAll(async () => {
  await raw().close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  h.noSubdomain = false;
  h.live.mockReset();
  h.live.mockResolvedValue({ kind: "live", sha: "rel-ab", overrides: [], splitBps: 5000 });
  h.tell.mockReset();
  h.tell.mockResolvedValue(undefined);
  h.purge.mockReset();
  h.purge.mockResolvedValue(undefined);
  h.cleanup.mockReset();
  h.cleanup.mockResolvedValue(undefined);
  h.merge.mockReset();
  h.merge.mockResolvedValue({ kind: "brought" });
  h.waitForLen.mockResolvedValue(false);
  h.rollback.mockReset();
  h.rollback.mockResolvedValue(undefined);
  h.publishProject.mockReset();
  h.publishProject.mockResolvedValue({ sha: "rel-republished" });
  h.tip.mockReset();
  h.tip.mockResolvedValue("tip-1");
  h.published = { commitOid: "pub-1", data: { html: "<html>A</html>" }, extraFiles: {} };
  h.filesAt.mockReset();
  h.filesAt.mockImplementation(async (_project: string, oid: string) => (oid === "pub-1" ? { ...A_FILES } : oid === "base-1" ? { ...A_FILES } : { ...A_FILES }));
  h.copy.mockReset();
  h.copy.mockResolvedValue({ data: { html: "<html>B</html>" }, folder: {} });
  await resetAbRows(raw());
  await raw().query(`INSERT INTO "projects" ("id","userId","title") VALUES ('copy-1','u1','copy')`);
});

const started = (id: string, o: Record<string, unknown> = {}) =>
  insertExperiment(raw(), { id, status: "running", startedAt: new Date(NOW.getTime() - 4 * DAY), controlReleaseSha: "rel-c", copyProjectId: "copy-1", branch: `ab/${id}`, baseCommitOid: "base-1", ...o });

describe("a started experiment whose live release doesn't carry its split", () => {
  it("🔴 the manifest is missing: the experiment is cancelled by the system, the edge purged, the copy cleaned up, the owner told once — and nothing is published", async () => {
    await started("ab_gone0001");
    h.live.mockResolvedValue({ kind: "none", sha: "rel-owner" });

    const stats = await run();

    const row = (await getExperimentById("ab_gone0001"))!;
    expect(row).toMatchObject({ status: "cancelled", decisionStatus: "resolved", decidedBy: SYSTEM_ACTOR, copyProjectId: null });
    expect(row.endedAt).not.toBeNull();
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(h.cleanup).toHaveBeenCalledWith({ parentId: "p1", copyProjectId: "copy-1", branch: "ab/ab_gone0001" });
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(h.tell).toHaveBeenCalledTimes(1);
    expect(h.tell.mock.calls[0]![2]).toBe("closed_by_system");
    expect(stats).toMatchObject({ cancelled: 1, promoted: 0 });
    // the next pass finds nothing live: told once
    await run();
    expect(h.tell).toHaveBeenCalledTimes(1);
  });

  it("the manifest names only OTHER experiments: the same", async () => {
    await started("ab_other001");
    h.live.mockResolvedValue({ kind: "other", sha: "rel-x" });
    await run();
    expect((await getExperimentById("ab_other001"))!.status).toBe("cancelled");
  });

  it("the project has no address any more: the same, without reading any release", async () => {
    await started("ab_nosub001");
    h.noSubdomain = true;
    await run();
    expect((await getExperimentById("ab_nosub001"))!.status).toBe("cancelled");
    expect(h.live).not.toHaveBeenCalled();
  });

  it("an experiment waiting for a decision (winner_ready, inconclusive) is looked at too: a live status is a live status", async () => {
    await started("ab_ready001", { status: "winner_ready", decisionStatus: "pending" });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-owner" });
    await run();
    expect((await getExperimentById("ab_ready001"))!.status).toBe("cancelled");
  });

  it("🔴 a release that can't be read says NOTHING: the experiment may still be splitting, so it is left alone", async () => {
    await started("ab_unk00001");
    h.live.mockResolvedValue({ kind: "unknown" });
    await run();
    expect((await getExperimentById("ab_unk00001"))!.status).toBe("running");
    expect(h.purge).not.toHaveBeenCalled();
    expect(h.tell).not.toHaveBeenCalled();
  });

  it("a healthy experiment (the manifest names it) is not touched", async () => {
    await started("ab_ok000001");
    await run();
    expect((await getExperimentById("ab_ok000001"))!.status).toBe("running");
    expect(h.tell).not.toHaveBeenCalled();
  });

  it("🔴 a decision being applied is not ours: the release isn't even read", async () => {
    await started("ab_dec00001", { status: "winner_ready", decisionStatus: "applying", decisionPrevStatus: "pending", decisionLockedAt: NOW, decisionLockToken: "tok" });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-owner" });
    await run();
    expect((await getExperimentById("ab_dec00001"))!.status).toBe("winner_ready");
    expect(h.live).not.toHaveBeenCalled();
  });

  it("🔴 a person claims the decision BETWEEN the pass's read and its write: the close doesn't land, and nothing is purged or told", async () => {
    await started("ab_race0001", { status: "winner_ready", decisionStatus: "pending" });
    h.live.mockImplementation(async () => {
      await claimExperimentDecision("ab_race0001", "p1");
      return { kind: "none", sha: "rel-owner" };
    });
    await run();
    const row = (await getExperimentById("ab_race0001"))!;
    expect(row.status).toBe("winner_ready");
    expect(row.decisionStatus).toBe("applying");
    expect(h.purge).not.toHaveBeenCalled();
    expect(h.cleanup).not.toHaveBeenCalled();
    expect(h.tell).not.toHaveBeenCalled();
  });
});

describe("a promote whose recording was lost after B went live", () => {
  it("🔴 B is at 100% with no split: the winner is recorded (`promoted_b`, the bring pending), brought into the draft, and the owner told", async () => {
    await started("ab_prom0001", { status: "winner_ready", decisionStatus: "pending" });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-promoted" });
    h.filesAt.mockImplementation(async (_p: string, oid: string) => (oid === "pub-1" ? { ...B_FILES } : { ...A_FILES }));

    const stats = await run();

    const row = (await getExperimentById("ab_prom0001"))!;
    expect(row).toMatchObject({ status: "promoted_b", decisionStatus: "resolved", winnerVariant: "b", promotedReleaseSha: "rel-promoted", decidedBy: SYSTEM_ACTOR });
    expect(h.merge).toHaveBeenCalledTimes(1);
    expect(row.bringState).toBe("brought");
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(h.tell).toHaveBeenCalledTimes(1);
    expect(h.tell.mock.calls[0]![2]).toBe("promoted_by_system");
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ promoted: 1, cancelled: 0 });
  });

  it("a bring that clashes stays `conflict` for the owner to resolve, as after any promote", async () => {
    await started("ab_prom0002", { status: "winner_ready", decisionStatus: "pending" });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-promoted" });
    h.filesAt.mockImplementation(async (_p: string, oid: string) => (oid === "pub-1" ? { ...B_FILES } : { ...A_FILES }));
    h.merge.mockResolvedValue({ kind: "conflict", paths: ["/index.html"] });
    await run();
    const row = (await getExperimentById("ab_prom0002"))!;
    expect(row.status).toBe("promoted_b");
    expect(row.bringState).toBe("conflict");
  });

  it("🔴 what is live is Control (the published sources are the baseline): it is a cancel, never a promotion", async () => {
    await started("ab_ctrl0001", { status: "winner_ready", decisionStatus: "pending" });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-c" });
    // published = baseline = A; the copy holds B
    await run();
    expect((await getExperimentById("ab_ctrl0001"))!.status).toBe("cancelled");
    expect(h.merge).not.toHaveBeenCalled();
  });

  it("what is live is neither Control nor B (the owner published something of their own): a cancel", async () => {
    await started("ab_own00001");
    h.live.mockResolvedValue({ kind: "none", sha: "rel-owner" });
    h.filesAt.mockImplementation(async (_p: string, oid: string) => (oid === "pub-1" ? { "/index.html": "<html>OWNER</html>" } : { ...A_FILES }));
    await run();
    expect((await getExperimentById("ab_own00001"))!.status).toBe("cancelled");
  });

  it("the copy is gone (deleted, or never kept): there is nothing to compare, so it is a cancel", async () => {
    await started("ab_nocopy01", { copyProjectId: null, branch: null });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-owner" });
    h.filesAt.mockImplementation(async (_p: string, oid: string) => (oid === "pub-1" ? { ...B_FILES } : { ...A_FILES }));
    await run();
    expect((await getExperimentById("ab_nocopy01"))!.status).toBe("cancelled");
  });
});

describe("a launch that never finished (a claimed slot, no start)", () => {
  // A launch's claim: `updatedAt` is when it was made, `decisionLockedAt` is the lease's clock (its last heartbeat; by default none since the claim).
  const claimed = (id: string, ageMin: number, o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), {
      id,
      status: "running",
      startedAt: null,
      updatedAt: new Date(NOW.getTime() - ageMin * MIN),
      decisionLockedAt: new Date(NOW.getTime() - ageMin * MIN),
      decisionLockToken: `tok-${id}`,
      controlReleaseSha: "rel-c",
      copyProjectId: "copy-1",
      branch: `ab/${id}`,
      baseCommitOid: "base-1",
      ...o,
    });

  it("🔴 the release carries its split: the launch is FINISHED from what the release says (start = the claim time, the live sha, the manifest's overrides and split)", async () => {
    await claimed("ab_strand001", 20);
    h.live.mockResolvedValue({ kind: "live", sha: "rel-ab", overrides: ["/app.css"], splitBps: 3000 });

    const stats = await run();

    const row = (await getExperimentById("ab_strand001"))!;
    expect(row.status).toBe("running");
    expect(row.decisionStatus).toBe("none");
    expect(row.startedAt?.getTime()).toBe(NOW.getTime() - 20 * MIN);
    expect(row.minEndAt?.getTime()).toBe(NOW.getTime() - 20 * MIN + 72 * 3_600_000);
    expect(row).toMatchObject({ experimentReleaseSha: "rel-ab", splitBps: 3000, variantBCommitOid: "tip-1", overridePaths: ["/app.css"] });
    expect(stats.launchesFinished).toBe(1);
  });

  it("🔴 the release doesn't carry it: the slot goes back to the draft (the owner can launch again)", async () => {
    await claimed("ab_strand002", 20);
    h.live.mockResolvedValue({ kind: "none", sha: "rel-c" });
    const stats = await run();
    const row = (await getExperimentById("ab_strand002"))!;
    expect(row.status).toBe("draft");
    expect(row.startedAt).toBeNull();
    expect(stats.launchesReleased).toBe(1);
  });

  it("a project with no address: the slot goes back too", async () => {
    await claimed("ab_strand003", 20);
    h.noSubdomain = true;
    await run();
    expect((await getExperimentById("ab_strand003"))!.status).toBe("draft");
  });

  it("🔴 a launch that is still running (claimed minutes ago) is left alone: its own final write is coming", async () => {
    await claimed("ab_fresh0001", 5);
    h.live.mockResolvedValue({ kind: "none", sha: "rel-c" });
    await run();
    expect((await getExperimentById("ab_fresh0001"))!.status).toBe("running");
    expect(h.live).not.toHaveBeenCalled();
    expect(LAUNCH_CLAIM_STALE_MS).toBe(15 * MIN);
  });

  it("an unreadable release settles nothing", async () => {
    await claimed("ab_strand004", 20);
    h.live.mockResolvedValue({ kind: "unknown" });
    await run();
    const row = (await getExperimentById("ab_strand004"))!;
    expect(row.status).toBe("running");
    expect(row.startedAt).toBeNull();
  });

  it("🔴 a launch that has been running a long time but KEEPS REFRESHING its lease is alive: the pass leaves it alone (round 3, A)", async () => {
    // claimed 40 minutes ago, last heartbeat 1 minute ago: a localized publish that is still going
    await claimed("ab_slow00001", 40, { decisionLockedAt: new Date(NOW.getTime() - MIN) });
    h.live.mockResolvedValue({ kind: "none", sha: "rel-c" });
    await run();
    expect((await getExperimentById("ab_slow00001"))!.status).toBe("running");
    expect(h.live).not.toHaveBeenCalled();
  });

  it("🔴 a heartbeat that lands between the pass's read and its write saves the launch: the release/finish is fenced on the clock it read", async () => {
    await claimed("ab_beat00001", 20);
    h.live.mockImplementation(async () => {
      await raw().query(`UPDATE "abExperiments" SET "decisionLockedAt" = $1 WHERE "id" = 'ab_beat00001'`, [new Date(NOW.getTime() - 1000)]);
      return { kind: "none", sha: "rel-c" };
    });
    await run();
    const row = (await getExperimentById("ab_beat00001"))!;
    expect(row.status).toBe("running");
    expect(row.startedAt).toBeNull();
  });

  it("🔴 a relaunch that re-claimed the slot (a new token) between the pass's read and its write isn't released by it", async () => {
    await claimed("ab_aba000001", 20);
    h.live.mockImplementation(async () => {
      await raw().query(`UPDATE "abExperiments" SET "decisionLockToken" = 'the-relaunch', "decisionLockedAt" = $1 WHERE "id" = 'ab_aba000001'`, [NOW]);
      return { kind: "none", sha: "rel-c" };
    });
    await run();
    expect(await getExperimentById("ab_aba000001")).toMatchObject({ status: "running", decisionLockToken: "the-relaunch" });
  });

  it("a finished launch carries no lease: its token and clock are cleared", async () => {
    await claimed("ab_clear0001", 20);
    h.live.mockResolvedValue({ kind: "live", sha: "rel-ab", overrides: [], splitBps: 5000 });
    await run();
    expect(await getExperimentById("ab_clear0001")).toMatchObject({ decisionLockToken: null, decisionLockedAt: null });
  });

  it("the launch's own final write wins the race: the reconcile's finish doesn't land and nothing is double-written", async () => {
    await claimed("ab_strand005", 20);
    h.live.mockImplementation(async () => {
      // the launch finished meanwhile
      await raw().query(`UPDATE "abExperiments" SET "startedAt" = $1, "experimentReleaseSha" = 'rel-launch' WHERE "id" = 'ab_strand005'`, [new Date(NOW.getTime() - MIN)]);
      return { kind: "live", sha: "rel-ab", overrides: [], splitBps: 5000 };
    });
    await run();
    const row = (await getExperimentById("ab_strand005"))!;
    expect(row.experimentReleaseSha).toBe("rel-launch");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A SPLIT THAT OUTLIVES ITS ROW (round 3, B): a system re-emit checks for a decision before it publishes and nothing re-checks after
// its swap, so a keep A (or harm stop, or «Stop and publish») that closed in between can have a split release swapped over its
// Control. The row is closed, the pass reads only live rows — so for the rows closed in the last 7 days it reads the live manifest too.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("a closed experiment whose split is still live (round 3, B)", () => {
  const closed = (id: string, status: string, o: Record<string, unknown> = {}) =>
    insertExperiment(raw(), { id, status, decisionStatus: "resolved", startedAt: new Date(NOW.getTime() - 5 * DAY), endedAt: new Date(NOW.getTime() - DAY), controlReleaseSha: "rel-c", copyProjectId: null, branch: null, ...o });

  it("🔴 the live manifest still names an experiment that was closed yesterday: the published sources are republished (abLive ending), the edge purged, and it is logged", async () => {
    await closed("ab_ghost0001", "kept_a");
    h.live.mockResolvedValue({ kind: "live", sha: "rel-reemit", overrides: ["/css/b.css"], splitBps: 5000 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stats = await run();
    expect(h.publishProject).toHaveBeenCalledTimes(1);
    expect(h.publishProject.mock.calls[0]![0]).toMatchObject({ projectId: "p1", userId: "u1", subdomain: "pan1", abLive: "ending", sourcesOverride: { data: { html: "<html>A</html>" } } });
    expect(h.publishProject.mock.calls[0]![0]).not.toHaveProperty("abExperiment");
    expect(h.purge).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/ab_ghost0001/);
    warn.mockRestore();
    expect(stats.splitsTakenDown).toBe(1);
    // a closed row stays what it is, and nobody is told: the owner already decided
    expect(await getExperimentById("ab_ghost0001")).toMatchObject({ status: "kept_a" });
    expect(h.tell).not.toHaveBeenCalled();
  });

  it("a promoted winner whose split came back is put right by rolling back to the release the promotion published", async () => {
    await closed("ab_ghost0002", "promoted_b", { bringState: "brought" });
    await raw().query(`UPDATE "abExperiments" SET "promotedReleaseSha" = 'rel-promoted' WHERE "id" = 'ab_ghost0002'`);
    h.live.mockResolvedValue({ kind: "live", sha: "rel-reemit", overrides: [], splitBps: 5000 });
    await run();
    expect(h.rollback).toHaveBeenCalledWith("pan1", "rel-promoted");
    expect(h.publishProject).not.toHaveBeenCalled();
  });

  it("🔴 nothing happens when the manifest doesn't name it, can't be read, or the row was closed more than a week ago", async () => {
    await closed("ab_ghost0003", "kept_a");
    h.live.mockResolvedValue({ kind: "none", sha: "rel-c" });
    await run();
    h.live.mockResolvedValue({ kind: "unknown" });
    await run();
    expect(h.publishProject).not.toHaveBeenCalled();

    await raw().query(`UPDATE "abExperiments" SET "endedAt" = $1, "decidedAt" = $1 WHERE "id" = 'ab_ghost0003'`, [new Date(NOW.getTime() - 8 * DAY)]);
    h.live.mockReset();
    h.live.mockResolvedValue({ kind: "live", sha: "rel-reemit", overrides: [], splitBps: 5000 });
    await run();
    expect(h.live).not.toHaveBeenCalled();
    expect(h.publishProject).not.toHaveBeenCalled();
  });

  it("a project whose NEW launch is in flight (a claimed slot) is left alone: its publish is the one writing the release", async () => {
    await closed("ab_ghost0004", "kept_a", { projectId: "p1" });
    await insertExperiment(raw(), { id: "ab_launch001", projectId: "p1", status: "running", startedAt: null, targetPath: "/pricing", updatedAt: NOW, decisionLockedAt: NOW, decisionLockToken: "tok" });
    h.live.mockResolvedValue({ kind: "live", sha: "rel-reemit", overrides: [], splitBps: 5000 });
    await run();
    expect(h.publishProject).not.toHaveBeenCalled();
  });

  it("a take-down that fails is logged and doesn't stop the pass; the next pass tries again", async () => {
    await closed("ab_ghost0005", "paused_harm");
    h.live.mockResolvedValue({ kind: "live", sha: "rel-reemit", overrides: [], splitBps: 5000 });
    h.publishProject.mockRejectedValueOnce(new Error("disco lleno"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(run()).resolves.toMatchObject({ splitsTakenDown: 0 });
    error.mockRestore();
    warn.mockRestore();
    await expect(run()).resolves.toMatchObject({ splitsTakenDown: 1 });
  });
});
