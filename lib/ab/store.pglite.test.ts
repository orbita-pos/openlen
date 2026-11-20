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
  createExperimentRow,
  pendingDecisionsForProjects,
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
