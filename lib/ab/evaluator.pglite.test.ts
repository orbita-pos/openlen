// @vitest-environment node
// THE EVALUATOR ON A REAL POSTGRES (review items 21 and 22): it never overwrites a person who is deciding, the harm brake
// takes the same claim a person does, and a notice that a deploy cut is sent by the next pass.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluatorDeps } from "./evaluator";
import { insertExperiment, openAbPglite, resetAbRows, type AbPglite } from "./testing/pglite";
import type { AbMetricsSnapshot } from "./types";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  db: null as unknown,
  notify: vi.fn(),
  purge: vi.fn(),
  ownerLocale: "en",
  liveAb: { kind: "live", sha: "x", overrides: [], splitBps: 5000 } as Record<string, unknown>,
  publishProject: vi.fn(),
  rollbackToSha: vi.fn(),
  published: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/assistants/store", () => ({ assistantOfProject: async () => null }));
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => false }));
vi.mock("@/lib/notifications/dispatch", () => ({ scheduleNotification: h.notify }));
vi.mock("@/lib/len-watch/owner", () => ({ projectForWatch: async () => ({ locale: h.ownerLocale }) }));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/ab/live-manifest", () => ({ readLiveAb: async () => h.liveAb }));
vi.mock("@/lib/len-watch/published-sources", () => ({ readPublishedSources: async () => h.published }));
vi.mock("@/lib/projects", () => ({ publishProject: h.publishProject }));
vi.mock("@/lib/projects/publish-through-gates", () => ({ runSecurityGate: vi.fn(), publishThroughGates: vi.fn() }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: h.purge }));
vi.mock("@/lib/publish/filesystem", () => ({ rollbackToSha: h.rollbackToSha }));
vi.mock("@/lib/ab/worktree", () => ({
  cleanupAbWorktree: vi.fn(async () => undefined),
  commitAbWorktree: vi.fn(),
  copySources: vi.fn(),
  createAbWorktree: vi.fn(),
  ensurePublishedSources: async () => h.published,
  mergeWinnerIntoDraft: vi.fn(),
  readPublishedFolder: async () => ({}),
}));

const { defaultEvaluatorDeps, evaluateRunningExperiments } = await import("./evaluator");
const { claimExperimentDecision, getExperimentById } = await import("./store");

const NOW = new Date("2026-11-19T14:00:00Z");
const DAY = 86_400_000;
let pglite: AbPglite;
const raw = (): PGlite => pglite.raw;

const snapshot = (verdict: AbMetricsSnapshot["stats"]["verdict"]): AbMetricsSnapshot => ({
  a: { views: 500, clicks: 40, conversions: 20, rate: 0.04 },
  b: { views: 500, clicks: 75, conversions: 35, rate: 0.07 },
  stats: {
    verdict,
    winner: verdict === "winner_b" ? "b" : verdict === "harm_stop" ? "a" : null,
    probBBeatsA: 0.98,
    probABeatsB: 0.02,
    probHarm30: verdict === "harm_stop" ? 0.97 : 0.01,
    expectedLossB: 0.0005,
    expectedLossA: 0.02,
    relativeLift: verdict === "harm_stop" ? -0.5 : 0.75,
    liftCiLow: 0.2,
    liftCiHigh: 1.2,
    alwaysValidP: 0.008,
    srmChi2: 0.1,
    srmWarning: false,
    durationHours: 96,
  },
  computedAt: NOW.toISOString(),
});

/** The real store, the real lifecycle; the metrics say what the test says, and the notice goes to a spy. */
async function depsWith(verdict: AbMetricsSnapshot["stats"]["verdict"], during?: () => Promise<void>): Promise<EvaluatorDeps> {
  const real = await defaultEvaluatorDeps();
  return {
    ...real,
    computeMetrics: async () => {
      await during?.();
      return snapshot(verdict);
    },
    notify: async (event, key) => void (await h.notify(event, key)),
  };
}

// The default deps load their modules on first use (the evaluator's cost at boot): that first load, under a loaded machine,
// is not what these tests measure — it is done once here, with room.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

beforeAll(async () => {
  pglite = await openAbPglite();
  h.db = pglite.db;
  await defaultEvaluatorDeps();
});
afterAll(async () => {
  await raw().close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  h.published = { commitOid: "base-1", data: { html: "<html>A</html>" }, extraFiles: {} };
  h.notify.mockResolvedValue(undefined);
  h.purge.mockReset();
  h.purge.mockResolvedValue(undefined);
  h.ownerLocale = "en";
  h.liveAb = { kind: "live", sha: "x", overrides: [], splitBps: 5000 };
  h.rollbackToSha.mockResolvedValue(undefined);
  await resetAbRows(raw());
});

const running = (id: string, o: Record<string, unknown> = {}) =>
  insertExperiment(raw(), { id, status: "running", startedAt: new Date(NOW.getTime() - 4 * DAY), controlReleaseSha: "rel-c", ...o });

describe("a person who is deciding wins (item 21)", () => {
  it("🔴 a person is applying a decision: the evaluator doesn't touch the experiment, and tells nobody", async () => {
    await running("ab_eval0001");
    await claimExperimentDecision("ab_eval0001", "p1");
    const stats = await evaluateRunningExperiments(await depsWith("winner_b"), NOW);
    expect(stats.evaluated).toBe(0);
    const row = (await getExperimentById("ab_eval0001"))!;
    expect(row).toMatchObject({ status: "running", decisionStatus: "applying", metricsSnapshot: null });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("🔴 a person claims the decision BETWEEN the evaluator's read and its write: the write doesn't land, nothing is announced", async () => {
    await running("ab_eval0002");
    const stats = await evaluateRunningExperiments(
      await depsWith("winner_b", async () => void (await claimExperimentDecision("ab_eval0002", "p1"))),
      NOW,
    );
    expect(stats).toMatchObject({ winners: 0, notifiedDirectly: 0 });
    const row = (await getExperimentById("ab_eval0002"))!;
    expect(row).toMatchObject({ status: "running", decisionStatus: "applying", winnerVariant: null, notifiedAt: null });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("🔴 the harm brake: a person is deciding → no rollback, no republish, no change, no notice", async () => {
    await running("ab_eval0003");
    const stats = await evaluateRunningExperiments(
      await depsWith("harm_stop", async () => void (await claimExperimentDecision("ab_eval0003", "p1"))),
      NOW,
    );
    expect(stats.harmStopped).toBe(0);
    expect(h.rollbackToSha).not.toHaveBeenCalled();
    expect(h.publishProject).not.toHaveBeenCalled();
    expect(await getExperimentById("ab_eval0003")).toMatchObject({ status: "running", decisionStatus: "applying" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("🔴 the harm brake with nobody deciding claims, restores Control, closes the experiment with the metrics, then announces", async () => {
    await running("ab_eval0004", { copyProjectId: "copy-1", branch: "ab/ab_eval0004" });
    const stats = await evaluateRunningExperiments(await depsWith("harm_stop"), NOW);
    expect(stats).toMatchObject({ harmStopped: 1, notifiedDirectly: 1 });
    expect(h.rollbackToSha).toHaveBeenCalledWith("pan1", "rel-c");
    const row = (await getExperimentById("ab_eval0004"))!;
    expect(row).toMatchObject({ status: "paused_harm", decisionStatus: "resolved", winnerVariant: "a", copyProjectId: null, decisionPrevStatus: null });
    expect(row.metricsSnapshot?.stats.verdict).toBe("harm_stop");
    expect(row.endedAt).toEqual(NOW);
    expect(row.notifiedAt).toEqual(NOW);
    expect(h.notify.mock.calls[0]![0]).toMatchObject({ verdict: "harm_stop", experimentId: "ab_eval0004" });
  });

  it("🔴 the harm stop purges the edge too: the target page and the assets B overrode (item 24)", async () => {
    await running("ab_eval0010", { targetPath: "/pricing" });
    await raw().query(`UPDATE "abExperiments" SET "overridePaths" = '["/css/site.css"]'::jsonb WHERE "id" = 'ab_eval0010'`);
    await evaluateRunningExperiments(await depsWith("harm_stop"), NOW);
    expect(h.purge).toHaveBeenCalledWith("pan1", ["/pricing", "/pricing/", "/pricing/index.html", "/css/site.css"]);
  });

  it("🔴 the harm brake that can't put Control back leaves the split running, gives the lock back, and says nothing", async () => {
    await running("ab_eval0005");
    h.rollbackToSha.mockRejectedValue(new Error("pruned"));
    h.published = null; // nothing to republish from either
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stats = await evaluateRunningExperiments(await depsWith("harm_stop"), NOW);
    warn.mockRestore();
    expect(stats.harmStopped).toBe(0);
    expect(await getExperimentById("ab_eval0005")).toMatchObject({ status: "running", decisionStatus: "none", decisionPrevStatus: null });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a verdict lands on an experiment nobody touched, and the notice is queued before notifiedAt is set", async () => {
    await running("ab_eval0006");
    const order: string[] = [];
    h.notify.mockImplementation(async () => void order.push("notify"));
    const deps = await depsWith("winner_b");
    const stats = await evaluateRunningExperiments(
      { ...deps, markNotified: async (id, at) => (order.push("marked"), deps.markNotified(id, at)) },
      NOW,
    );
    expect(stats).toMatchObject({ winners: 1, notifiedDirectly: 1 });
    expect(order).toEqual(["notify", "marked"]);
    expect(await getExperimentById("ab_eval0006")).toMatchObject({ status: "winner_ready", decisionStatus: "pending", winnerVariant: "b", notifiedAt: NOW });
  });
});

describe("the reconcile pass is wired into the pass (ruling 5)", () => {
  it("🔴 a started experiment whose live release doesn't carry its split is closed BEFORE it is judged, and the owner gets one notice, in their language", async () => {
    h.ownerLocale = "es";
    h.liveAb = { kind: "none", sha: "rel-owner" };
    await running("ab_reco0001");
    const deps = await depsWith("winner_b");
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(await getExperimentById("ab_reco0001")).toMatchObject({ status: "cancelled", decisionStatus: "resolved", decidedBy: "system" });
    // it wasn't judged: no snapshot was computed for it, no winner was announced
    expect(stats).toMatchObject({ evaluated: 0, winners: 0 });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0]).toMatchObject({ type: "ab_result", verdict: "closed_by_system", locale: "es", recipientUserId: "u1" });
    expect(h.publishProject).not.toHaveBeenCalled();
  });
});

describe("the notice is written in the owner's language (item 29)", () => {
  it("🔴 the default deps read it the way Len Watch does, and the notice carries it", async () => {
    await running("ab_eval0009");
    h.ownerLocale = "pt";
    await evaluateRunningExperiments(await depsWith("winner_b"), NOW);
    const event = h.notify.mock.calls[0]![0] as { locale: string; emailText: string };
    expect(event.locale).toBe("pt");
    expect(event.emailText).toContain("/pt/new?project=p1");
  });
});

describe("a notice a deploy cut is sent by the next pass (item 22)", () => {
  it("🔴 the queue is down: the verdict is saved, notifiedAt stays null; the next pass sends it and only then marks it", async () => {
    await running("ab_eval0007");
    h.notify.mockRejectedValueOnce(new Error("queue down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await evaluateRunningExperiments(await depsWith("winner_b"), NOW);
    warn.mockRestore();
    expect(await getExperimentById("ab_eval0007")).toMatchObject({ status: "winner_ready", notifiedAt: null });

    const later = new Date(NOW.getTime() + 30 * 60_000);
    const stats = await evaluateRunningExperiments(await depsWith("collecting"), later);
    expect(stats.notifiedDirectly).toBe(1);
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(h.notify.mock.calls[1]![1]).toBe("ab_result:ab_eval0007:winner_b");
    expect((await getExperimentById("ab_eval0007"))!.notifiedAt).toEqual(later);

    // Told: a third pass sends nothing.
    await evaluateRunningExperiments(await depsWith("collecting"), new Date(later.getTime() + 30 * 60_000));
    expect(h.notify).toHaveBeenCalledTimes(2);
  });

  it("🔴 a system close whose notice couldn't be queued is sent by the next pass (round 3, C), once; a person's own close is never announced", async () => {
    h.liveAb = { kind: "none", sha: "rel-owner" };
    await running("ab_eval0009");
    // another experiment that a person closed: not the system's to announce
    await insertExperiment(raw(), { id: "ab_eval0010", projectId: "p2", status: "cancelled", decisionStatus: "resolved", startedAt: new Date(NOW.getTime() - 3 * DAY), endedAt: new Date(NOW.getTime() - DAY) });
    await raw().query(`UPDATE "abExperiments" SET "decidedBy" = 'u1' WHERE "id" = 'ab_eval0010'`);
    // the queue is down for the whole pass: the reconcile's own try, and the sweep that follows it in the same pass
    h.notify.mockRejectedValueOnce(new Error("queue down")).mockRejectedValueOnce(new Error("queue down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await evaluateRunningExperiments(await depsWith("winner_b"), NOW);
    warn.mockRestore();
    expect(await getExperimentById("ab_eval0009")).toMatchObject({ status: "cancelled", decidedBy: "system", notifiedAt: null });

    h.liveAb = { kind: "live", sha: "x", overrides: [], splitBps: 5000 };
    const later = new Date(NOW.getTime() + 30 * 60_000);
    const stats = await evaluateRunningExperiments(await depsWith("collecting"), later);
    expect(stats.notifiedDirectly).toBe(1);
    expect(h.notify).toHaveBeenCalledTimes(3);
    expect(h.notify.mock.calls[2]![1]).toBe("ab_result:ab_eval0009:closed_by_system");
    expect((await getExperimentById("ab_eval0009"))!.notifiedAt).toEqual(later);
    expect((await getExperimentById("ab_eval0010"))!.notifiedAt).toBeNull();
    await evaluateRunningExperiments(await depsWith("collecting"), new Date(later.getTime() + 30 * 60_000));
    expect(h.notify).toHaveBeenCalledTimes(3);
  });

  it("🔴 the stale-lock sweep runs in the pass: a decision that died is given back before the experiment is looked at", async () => {
    await running("ab_eval0008", {
      status: "winner_ready",
      decisionStatus: "applying",
      decisionPrevStatus: "pending",
      decisionLockedAt: new Date(NOW.getTime() - 20 * 60_000),
      notifiedAt: NOW,
    });
    await evaluateRunningExperiments(await depsWith("collecting"), NOW);
    expect(await getExperimentById("ab_eval0008")).toMatchObject({ decisionStatus: "pending", decisionLockedAt: null });
  });
});
