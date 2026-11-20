// @vitest-environment node
// Real Postgres (PGlite) contract tests for OpenLen Edge A/B Testing (Plan 3):
//   - Idempotent migration DDL (`runAbTestingMigration`)
//   - Unique partial index enforcing at most ONE active experiment per (projectId, targetPath)
//   - Atomic CAS race on `claimExperimentDecision` (double-click Web + Mobile)
//   - Live SQL attribution in `computeExperimentMetrics` + `upsertExperimentDailySnapshot`
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { runAbTestingMigration, type MigrationClient } from "@/scripts/ab-testing-migrate-sql";

const base = vi.hoisted(() => ({ db: null as unknown, pg: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const {
  claimExperimentDecision,
  claimLaunch,
  finalizeLaunch,
  heartbeatLaunchLease,
  releaseLaunch,
  createExperimentRow,
  closeDecision,
  heartbeatDecisionLock,
  pendingDecisionsForProjects,
  pendingExperimentViewsForProjects,
  recordReemittedRelease,
  releaseDecisionLock,
  releaseStaleDecisionLocks,
  updateExperiment,
} = await import("./store");
const { computeExperimentMetrics, upsertExperimentDailySnapshot } = await import("./metrics");

const pg = () => base.pg as PGlite;

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY, "userId" text NOT NULL, "title" text NOT NULL DEFAULT 'Sitio');`);
  await db.query(`CREATE TABLE "assistants" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "pageEvents" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "type" text NOT NULL, "cid" text, "uaHash" text, "ts" timestamp NOT NULL DEFAULT now());`);
  await db.query(`CREATE TABLE "formSubmissions" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "meta" jsonb, "createdAt" timestamp NOT NULL DEFAULT now());`);
  await db.query(`CREATE TABLE "bookings" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "cid" text, "createdAt" timestamp NOT NULL DEFAULT now());`);
  await db.query(`INSERT INTO "projects" ("id", "userId", "title") VALUES ('p1', 'u1', 'Panadería Sol');`);
  await runAbTestingMigration(db as unknown as MigrationClient);
  base.pg = db;
  base.db = drizzle(db, { schema });
});

describe("lib/ab/store & metrics (PGlite)", () => {
  it("migration DDL is idempotent when re-executed", async () => {
    await expect(runAbTestingMigration(pg() as unknown as MigrationClient)).resolves.toBeUndefined();
  });

  it("enforces at most one active experiment per (projectId, targetPath) via partial unique index", async () => {
    await createExperimentRow({
      id: "ab_11111111",
      projectId: "p1",
      name: "Hero v1",
      targetPath: "/",
      primaryMetric: "conversion_any",
      splitBps: 5000,
      salt: "s1",
      status: "running",
      decisionStatus: "none",
      createdBy: "u1",
    });

    await expect(
      createExperimentRow({
        id: "ab_22222222",
        projectId: "p1",
        name: "Hero duplicate",
        targetPath: "/",
        primaryMetric: "conversion_any",
        splitBps: 5000,
        salt: "s2",
        status: "draft",
        decisionStatus: "none",
        createdBy: "u1",
      }),
    ).rejects.toThrow();

    // A different targetPath on the same project IS allowed.
    const pricing = await createExperimentRow({
      id: "ab_33333333",
      projectId: "p1",
      name: "Pricing CTA",
      targetPath: "/pricing",
      primaryMetric: "cta_click",
      splitBps: 5000,
      salt: "s3",
      status: "draft",
      decisionStatus: "none",
      createdBy: "u1",
    });
    expect(pricing.targetPath).toBe("/pricing");

    // Once the first experiment reaches a terminal status, a new active experiment on "/" succeeds.
    await updateExperiment("ab_11111111", { status: "promoted_b", decisionStatus: "resolved" });
    const next = await createExperimentRow({
      id: "ab_44444444",
      projectId: "p1",
      name: "Hero v2",
      targetPath: "/",
      primaryMetric: "conversion_any",
      splitBps: 5000,
      salt: "s4",
      status: "draft",
      decisionStatus: "none",
      createdBy: "u1",
    });
    expect(next.id).toBe("ab_44444444");
  });

  it("claimExperimentDecision CAS grants the lock to exactly one caller on concurrent clicks", async () => {
    await createExperimentRow({
      id: "ab_cas12345",
      projectId: "p1",
      name: "Botón contacto",
      targetPath: "/",
      primaryMetric: "form_submit",
      splitBps: 5000,
      salt: "s1",
      status: "winner_ready",
      decisionStatus: "pending",
      winnerVariant: "b",
      startedAt: new Date(Date.now() - 86_400_000),
      evaluatedAt: new Date(),
      createdBy: "u1",
    });

    const [first, second] = await Promise.all([
      claimExperimentDecision("ab_cas12345", "p1"),
      claimExperimentDecision("ab_cas12345", "p1"),
    ]);

    const winners = [first, second].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.decisionStatus).toBe("applying");

    // Pending decisions query no longer lists an applying row.
    const pending = await pendingDecisionsForProjects(["p1"]);
    expect(pending).toHaveLength(0);
  });

  it("🔴 the screens' cards list the decisions waiting AND the experiments stopped for harm in the last 14 days (item 23)", async () => {
    await pg().query(`INSERT INTO "projects" ("id", "userId", "title") VALUES ('p2','u1','Tienda'), ('p3','u1','Blog'), ('p4','u1','Otro');`);
    const now = new Date("2026-11-19T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const mk = (id: string, projectId: string, patch: Partial<Parameters<typeof createExperimentRow>[0]>) =>
      createExperimentRow({ id, projectId, name: id, targetPath: "/", primaryMetric: "conversion_any", splitBps: 5000, salt: "s", createdBy: "u1", status: "running", decisionStatus: "none", ...patch });
    await mk("ab_pending1", "p1", { status: "winner_ready", decisionStatus: "pending", evaluatedAt: ago(1) });
    await mk("ab_harmnew1", "p2", { status: "paused_harm", decisionStatus: "resolved", endedAt: ago(3), evaluatedAt: ago(3) });
    await mk("ab_harmold1", "p3", { status: "paused_harm", decisionStatus: "resolved", endedAt: ago(20), evaluatedAt: ago(20) });
    await mk("ab_running1", "p4", { status: "running", decisionStatus: "none" });

    const views = await pendingExperimentViewsForProjects(["p1", "p2", "p3", "p4"], now);
    expect(views.map((v) => [v.id, v.status, v.decisionStatus])).toEqual([
      ["ab_pending1", "winner_ready", "pending"],
      ["ab_harmnew1", "paused_harm", "resolved"],
    ]);
    // The morning summary still talks only of what needs a decision.
    expect((await pendingDecisionsForProjects(["p1", "p2", "p3", "p4"])).map((x) => x.experimentId)).toEqual(["ab_pending1"]);
  });

  it("🔴 the morning summary lists a pending decision only until it has told it (notifiedAt), the cards keep showing it (item 29)", async () => {
    const mk = (id: string, patch: Partial<Parameters<typeof createExperimentRow>[0]>) =>
      createExperimentRow({ id, projectId: "p1", name: id, targetPath: `/${id}`, primaryMetric: "conversion_any", splitBps: 5000, salt: "s", createdBy: "u1", status: "winner_ready", decisionStatus: "pending", evaluatedAt: new Date(), ...patch });
    await pg().query(`INSERT INTO "projects" ("id", "userId", "title") VALUES ('p2','u1','Tienda');`);
    await mk("ab_untold01", {});
    await mk("ab_told0001", { projectId: "p2", notifiedAt: new Date() });
    expect((await pendingDecisionsForProjects(["p1", "p2"])).map((x) => x.experimentId)).toEqual(["ab_untold01"]);
    expect((await pendingExperimentViewsForProjects(["p1", "p2"])).map((v) => v.id).sort()).toEqual(["ab_told0001", "ab_untold01"]);
  });

  it("🔴 a re-emit is recorded only on a LIVE experiment: one a decision closed meanwhile keeps its record", async () => {
    await createExperimentRow({ id: "ab_reemit02", projectId: "p1", name: "r", targetPath: "/", primaryMetric: "conversion_any", splitBps: 5000, salt: "s", createdBy: "u1", status: "kept_a", decisionStatus: "resolved", controlReleaseSha: "kept-control", experimentReleaseSha: "old-exp", overridePaths: ["/a.css"] });
    expect(await recordReemittedRelease("ab_reemit02", "new-release", ["/a.css", "/b.css"])).toEqual({ recorded: false, added: ["/b.css"] });
    const [row] = (await pg().query<{ experimentReleaseSha: string; controlReleaseSha: string | null; overridePaths: string[] }>(`SELECT "experimentReleaseSha", "controlReleaseSha", "overridePaths" FROM "abExperiments" WHERE "id" = 'ab_reemit02'`)).rows;
    expect(row).toEqual({ experimentReleaseSha: "old-exp", controlReleaseSha: "kept-control", overridePaths: ["/a.css"] });
  });

  it("🔴 a system re-emit makes the new release the experiment's AND clears the stale fallback: keep-A/harm no longer roll back over what the republish carried (G1+G3 item 18)", async () => {
    await createExperimentRow({ id: "ab_reemit01", projectId: "p1", name: "r", targetPath: "/", primaryMetric: "conversion_any", splitBps: 5000, salt: "s", createdBy: "u1", status: "running", decisionStatus: "none", controlReleaseSha: "old-control", experimentReleaseSha: "old-exp" });
    expect(await recordReemittedRelease("ab_reemit01", "new-release")).toEqual({ recorded: true, added: [] });
    const [row] = (await pg().query<{ experimentReleaseSha: string; controlReleaseSha: string | null }>(`SELECT "experimentReleaseSha", "controlReleaseSha" FROM "abExperiments" WHERE "id" = 'ab_reemit01'`)).rows;
    expect(row).toEqual({ experimentReleaseSha: "new-release", controlReleaseSha: null });
  });

  it("computeExperimentMetrics deduplicates repeat reloads and attributes forms + CTA clicks cleanly", async () => {
    await createExperimentRow({
      id: "ab_metr1234",
      projectId: "p1",
      name: "Métricas SQL",
      targetPath: "/",
      primaryMetric: "conversion_any",
      splitBps: 5000,
      salt: "s1",
      status: "running",
      decisionStatus: "none",
      createdBy: "u1",
    });
    const start = new Date("2026-11-15T00:00:00Z");
    const now = new Date("2026-11-19T00:00:00Z");

    // Visitor a1 reloads twice (should count as 1 unique view!), visitor a2 views once
    await pg().query(
      `INSERT INTO "pageEvents" ("id","projectId","type","cid","uaHash","ab","ts") VALUES
        ('e1','p1','view','cid_a1','h1','ab_metr1234:a','2026-11-16T10:00:00Z'),
        ('e2','p1','view','cid_a1','h1','ab_metr1234:a','2026-11-16T10:05:00Z'),
        ('e3','p1','view','cid_a2','h2','ab_metr1234:a','2026-11-16T11:00:00Z'),
        ('e4','p1','view','cid_b1','h3','ab_metr1234:b','2026-11-16T10:00:00Z'),
        ('e5','p1','cta','cid_b1','h3','ab_metr1234:b','2026-11-16T10:01:00Z'),
        ('e6','p1','view','cid_b2','h4','ab_metr1234:b','2026-11-16T12:00:00Z');`,
    );
    // Visitor b1 submits a form (statically attributed via meta->>'ab'); visitor b2 books (via cid)
    await pg().query(
      `INSERT INTO "formSubmissions" ("id","projectId","meta","createdAt") VALUES
        ('f1','p1','{"ab":"ab_metr1234:b","cid":"cid_b1"}'::jsonb,'2026-11-16T10:02:00Z');`,
    );
    await pg().query(
      `INSERT INTO "bookings" ("id","projectId","cid","createdAt") VALUES
        ('bk1','p1','cid_b2','2026-11-16T12:05:00Z');`,
    );

    const snap = await computeExperimentMetrics(
      {
        experimentId: "ab_metr1234",
        projectId: "p1",
        primaryMetric: "conversion_any",
        splitBps: 5000,
        startedAt: start,
      },
      now,
    );
    expect(snap.a.views).toBe(2);
    expect(snap.a.conversions).toBe(0);
    expect(snap.b.views).toBe(2);
    expect(snap.b.clicks).toBe(1);
    expect(snap.b.conversions).toBe(2);

    // Upsert daily snapshot twice (idempotent conflict update)
    await upsertExperimentDailySnapshot("ab_metr1234", "2026-11-19", "b", snap.b);
    await upsertExperimentDailySnapshot("ab_metr1234", "2026-11-19", "b", {
      ...snap.b,
      views: 5,
    });
    const daily = await pg().query<{ views: number }>(
      `SELECT "views" FROM "abExperimentDaily" WHERE "experimentId" = 'ab_metr1234' AND "variant" = 'b'`,
    );
    expect(daily.rows[0]?.views).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DECISION LOCK IS FENCED (review: stale-lock recovery). A claim has a token; the decision refreshes the lock's clock
// under it and writes its close under it; the sweep clears the token — so a decision whose lock was taken over can't write.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the decision lock's token (fencing)", () => {
  const live = (id: string, o: Partial<Parameters<typeof createExperimentRow>[0]> = {}) =>
    createExperimentRow({ id, projectId: "p1", name: id, targetPath: "/", primaryMetric: "conversion_any", splitBps: 5000, salt: "s", createdBy: "u1", status: "winner_ready", decisionStatus: "pending", startedAt: new Date(Date.now() - 86_400_000), ...o });
  const row = async (id: string) => (await pg().query<Record<string, unknown>>(`SELECT * FROM "abExperiments" WHERE "id" = $1`, [id])).rows[0]!;

  it("🔴 an experiment whose launch hasn't finished (running, no start) can't be claimed by a decision", async () => {
    await live("ab_launching", { status: "running", decisionStatus: "none", startedAt: null });
    expect(await claimExperimentDecision("ab_launching", "p1")).toBeNull();
    expect((await row("ab_launching")).decisionStatus).toBe("none");
  });

  it("every claim carries its own token, and the previous status", async () => {
    await live("ab_token0001");
    const a = (await claimExperimentDecision("ab_token0001", "p1"))!;
    expect(a.decisionLockToken).toMatch(/^[0-9a-f]{24}$/);
    await releaseDecisionLock("ab_token0001", a.decisionLockToken);
    const b = (await claimExperimentDecision("ab_token0001", "p1"))!;
    expect(b.decisionLockToken).not.toBe(a.decisionLockToken);
    expect(b.decisionPrevStatus).toBe("pending");
  });

  it("🔴 the heartbeat refreshes the lock's clock only under its own token, and only while the row is applying", async () => {
    await live("ab_beat0001");
    const claimed = (await claimExperimentDecision("ab_beat0001", "p1"))!;
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await heartbeatDecisionLock("ab_beat0001", "not-the-token", later)).toBe(false);
    expect(((await row("ab_beat0001")).decisionLockedAt as Date).getTime()).toBeLessThan(later.getTime() - 4 * 60_000);
    expect(await heartbeatDecisionLock("ab_beat0001", claimed.decisionLockToken!, later)).toBe(true);
    expect(((await row("ab_beat0001")).decisionLockedAt as Date).getTime()).toBe(later.getTime());
    await releaseDecisionLock("ab_beat0001", claimed.decisionLockToken);
    expect(await heartbeatDecisionLock("ab_beat0001", claimed.decisionLockToken!, later)).toBe(false);
  });

  it("🔴 a lock that is refreshed is not stale however long the decision runs; one that isn't, is", async () => {
    await live("ab_beat0002");
    const claimed = (await claimExperimentDecision("ab_beat0002", "p1"))!;
    await pg().query(`UPDATE "abExperiments" SET "decisionLockedAt" = now() - interval '25 minutes' WHERE "id" = 'ab_beat0002'`);
    await heartbeatDecisionLock("ab_beat0002", claimed.decisionLockToken!); // it is alive: the clock is now
    expect(await releaseStaleDecisionLocks()).toEqual([]);
    await pg().query(`UPDATE "abExperiments" SET "decisionLockedAt" = now() - interval '11 minutes' WHERE "id" = 'ab_beat0002'`);
    expect(await releaseStaleDecisionLocks()).toEqual(["ab_beat0002"]);
    expect((await row("ab_beat0002")).decisionLockToken).toBeNull();
  });

  it("🔴 a decision whose lock the sweep gave away (and another took) cannot write its close; the new holder can", async () => {
    await live("ab_fence0001");
    const first = (await claimExperimentDecision("ab_fence0001", "p1"))!;
    await pg().query(`UPDATE "abExperiments" SET "decisionLockedAt" = now() - interval '20 minutes' WHERE "id" = 'ab_fence0001'`);
    expect(await releaseStaleDecisionLocks()).toEqual(["ab_fence0001"]);
    const second = (await claimExperimentDecision("ab_fence0001", "p1"))!;
    expect(second.decisionLockToken).not.toBe(first.decisionLockToken);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await closeDecision("ab_fence0001", first.decisionLockToken, { status: "kept_a", decisionStatus: "resolved" })).toBeNull();
    expect(error.mock.calls.flat().join(" ")).toMatch(/MISSED/);
    error.mockRestore();
    // nothing was overwritten, and the first one's give-back doesn't free the second's lock either
    await releaseDecisionLock("ab_fence0001", first.decisionLockToken);
    expect(await row("ab_fence0001")).toMatchObject({ status: "winner_ready", decisionStatus: "applying", decisionLockToken: second.decisionLockToken });

    const closed = await closeDecision("ab_fence0001", second.decisionLockToken, { status: "kept_a", decisionStatus: "resolved" });
    expect(closed).toMatchObject({ status: "kept_a", decisionStatus: "resolved", decisionLockToken: null, decisionLockedAt: null, decisionPrevStatus: null });
  });

  it("a close with no token never lands", async () => {
    await live("ab_fence0002");
    await claimExperimentDecision("ab_fence0002", "p1");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await closeDecision("ab_fence0002", null, { status: "kept_a" })).toBeNull();
    error.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE LAUNCH CLAIM IS A LEASE (round 3, A): the same token and clock as a decision's lock, on a row that has no start yet (a
// decision can't claim such a row, so they never overlap). Everything that settles a launch is fenced on the token.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the launch lease (round 3, A)", () => {
  const draft = (id: string) =>
    createExperimentRow({ id, projectId: "p1", name: id, targetPath: "/", primaryMetric: "conversion_any", splitBps: 5000, salt: "s", createdBy: "u1", status: "draft", decisionStatus: "none" });
  const row = async (id: string) => (await pg().query<Record<string, unknown>>(`SELECT * FROM "abExperiments" WHERE "id" = $1`, [id])).rows[0]!;
  const PATCH = { status: "running" as const, decisionStatus: "none" as const, startedAt: new Date(), experimentReleaseSha: "rel-1" };

  it("🔴 the claim takes a fresh token and starts the lease's clock; every claim has its own", async () => {
    await draft("ab_lease0001");
    const claimed = (await claimLaunch("ab_lease0001")) as { decisionLockToken: string | null; decisionLockedAt: Date | null; startedAt: Date | null };
    expect(claimed.decisionLockToken).toMatch(/^[0-9a-f]{24}$/);
    expect(claimed.decisionLockedAt).toBeInstanceOf(Date);
    expect(claimed.startedAt).toBeNull();
    await releaseLaunch("ab_lease0001", { token: claimed.decisionLockToken });
    const again = (await claimLaunch("ab_lease0001")) as { decisionLockToken: string | null };
    expect(again.decisionLockToken).not.toBe(claimed.decisionLockToken);
  });

  it("🔴 the heartbeat refreshes the clock only under its own token, and only while the launch hasn't finished", async () => {
    await draft("ab_lease0002");
    const claimed = (await claimLaunch("ab_lease0002")) as { decisionLockToken: string };
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await heartbeatLaunchLease("ab_lease0002", "not-the-token", later)).toBe(false);
    expect(await heartbeatLaunchLease("ab_lease0002", claimed.decisionLockToken, later)).toBe(true);
    expect(((await row("ab_lease0002")).decisionLockedAt as Date).getTime()).toBe(later.getTime());
    await finalizeLaunch("ab_lease0002", { token: claimed.decisionLockToken }, PATCH);
    expect(await heartbeatLaunchLease("ab_lease0002", claimed.decisionLockToken, later)).toBe(false);
  });

  it("🔴 the final write is fenced: another claim's token misses; the claim's own lands, and clears the lease", async () => {
    await draft("ab_lease0003");
    const claimed = (await claimLaunch("ab_lease0003")) as { decisionLockToken: string };
    expect(await finalizeLaunch("ab_lease0003", { token: "someone-elses" }, PATCH)).toBeNull();
    expect((await row("ab_lease0003")).startedAt).toBeNull();
    const done = await finalizeLaunch("ab_lease0003", { token: claimed.decisionLockToken }, PATCH);
    expect(done).toMatchObject({ status: "running", decisionLockToken: null, decisionLockedAt: null });
    expect(done!.startedAt).toBeInstanceOf(Date);
  });

  it("🔴 giving the slot back is fenced too: a launch that lost its claim can't release the next one's", async () => {
    await draft("ab_lease0004");
    const first = (await claimLaunch("ab_lease0004")) as { decisionLockToken: string };
    await releaseLaunch("ab_lease0004", { token: first.decisionLockToken }); // the reconcile pass gave it back
    const second = (await claimLaunch("ab_lease0004")) as { decisionLockToken: string }; // the relaunch
    await releaseLaunch("ab_lease0004", { token: first.decisionLockToken }); // the first launch's late release
    expect(await row("ab_lease0004")).toMatchObject({ status: "running", decisionLockToken: second.decisionLockToken });
    await releaseLaunch("ab_lease0004", { token: second.decisionLockToken });
    expect(await row("ab_lease0004")).toMatchObject({ status: "draft", decisionLockToken: null, decisionLockedAt: null });
  });

  it("🔴 the reconcile pass's fence also names the clock it read: a heartbeat that landed since makes its write miss", async () => {
    await draft("ab_lease0005");
    const claimed = (await claimLaunch("ab_lease0005")) as { decisionLockToken: string; decisionLockedAt: Date };
    const read = claimed.decisionLockedAt;
    await heartbeatLaunchLease("ab_lease0005", claimed.decisionLockToken, new Date(read.getTime() + 60_000));
    expect(await finalizeLaunch("ab_lease0005", { token: claimed.decisionLockToken, lockedAt: read }, PATCH)).toBeNull();
    await releaseLaunch("ab_lease0005", { token: claimed.decisionLockToken, lockedAt: read });
    expect((await row("ab_lease0005")).status).toBe("running");
    // …and with the clock it really has, it lands
    const current = (await row("ab_lease0005")).decisionLockedAt as Date;
    expect(await finalizeLaunch("ab_lease0005", { token: claimed.decisionLockToken, lockedAt: current }, PATCH)).not.toBeNull();
  });

  it("a row from before the lease (no token, no clock) is fenced on null", async () => {
    await pg().query(`INSERT INTO "abExperiments" ("id","projectId","name","targetPath","salt","status","decisionStatus","createdBy") VALUES ('ab_lease0006','p1','x','/','s','running','none','u1')`);
    expect(await finalizeLaunch("ab_lease0006", { token: "something" }, PATCH)).toBeNull();
    expect(await finalizeLaunch("ab_lease0006", { token: null, lockedAt: null }, PATCH)).not.toBeNull();
  });
});
