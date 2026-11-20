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
vi.mock("@/lib/len-watch/published-sources", () => ({ readPublishedSources: async () => h.published }));
vi.mock("@/lib/projects", () => ({ publishProject: h.publishProject }));
vi.mock("@/lib/projects/publish-through-gates", () => ({ runSecurityGate: vi.fn(), publishThroughGates: h.publishThroughGates }));
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: async () => undefined }));
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
  };
});

const { extendExperiment, keepControlA, promoteVariantB } = await import("./lifecycle");
const { claimExperimentDecision, releaseStaleDecisionLocks, getExperimentById } = await import("./store");
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
