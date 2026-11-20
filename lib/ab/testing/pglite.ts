// A real Postgres (PGlite) with just the tables the A/B lifecycle, evaluator and metrics touch, built by the SAME
// migration the deploy runs. For `*.pglite.test.ts` only — one PGlite per test FILE (a WASM Postgres per test crashed
// the worker once), every test resetting its rows with `resetAbRows`.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/lib/db/schema";
import { runAbTestingMigration, type MigrationClient } from "@/scripts/ab-testing-migrate-sql";

export interface AbPglite {
  readonly raw: PGlite;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
}

export async function openAbPglite(): Promise<AbPglite> {
  const raw = new PGlite();
  await raw.query(`CREATE TABLE "projects" (
    "id" text PRIMARY KEY, "userId" text NOT NULL, "title" text NOT NULL DEFAULT 'Sitio', "data" jsonb, "subdomain" text,
    "publishedAt" timestamp, "publishedReleaseSha" text, "updatedAt" timestamp);`);
  await raw.query(`CREATE TABLE "assistants" ("id" text PRIMARY KEY);`);
  await raw.query(`CREATE TABLE "pageEvents" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "type" text NOT NULL, "cid" text, "uaHash" text, "ts" timestamp NOT NULL DEFAULT now());`);
  await raw.query(`CREATE TABLE "formSubmissions" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "meta" jsonb, "createdAt" timestamp NOT NULL DEFAULT now());`);
  await raw.query(`CREATE TABLE "bookings" ("id" text PRIMARY KEY, "projectId" text NOT NULL, "cid" text, "createdAt" timestamp NOT NULL DEFAULT now());`);
  await runAbTestingMigration(raw as unknown as MigrationClient, { sleep: async () => undefined });
  return { raw, db: drizzle(raw, { schema }) };
}

/** Empties what a test wrote and leaves six projects `p1`..`p6` (owner `u1`, published at `pan1`..`pan6`): a project has ONE live
 *  experiment at a time, so tests that need several live ones put each on its own project. */
export async function resetAbRows(raw: PGlite): Promise<void> {
  await raw.exec(`DELETE FROM "abExperimentDaily"; DELETE FROM "abExperiments"; DELETE FROM "pageEvents"; DELETE FROM "formSubmissions"; DELETE FROM "bookings"; DELETE FROM "projects";`);
  for (let i = 1; i <= 6; i++) {
    await raw.query(
      `INSERT INTO "projects" ("id","userId","title","subdomain","publishedReleaseSha","data") VALUES ($1,'u1','Panadería','pan' || $2,'rel-live','{"html":"<html>A</html>"}')`,
      [`p${i}`, String(i)],
    );
  }
}

/** One experiment row with only what the test cares about; the rest takes the column defaults. */
export async function insertExperiment(
  raw: PGlite,
  o: {
    readonly id: string;
    readonly projectId?: string;
    readonly status?: string;
    readonly decisionStatus?: string;
    readonly targetPath?: string;
    readonly startedAt?: Date | null;
    readonly endedAt?: Date | null;
    readonly maxEndAt?: Date | null;
    readonly snoozeUntil?: Date | null;
    readonly notifiedAt?: Date | null;
    readonly winnerVariant?: string | null;
    readonly bringState?: string | null;
    readonly copyProjectId?: string | null;
    readonly branch?: string | null;
    readonly baseCommitOid?: string | null;
    readonly controlReleaseSha?: string | null;
    readonly metricsSnapshot?: unknown;
    readonly updatedAt?: Date;
    readonly decisionPrevStatus?: string | null;
    readonly decisionLockedAt?: Date | null;
    readonly name?: string;
  },
): Promise<void> {
  await raw.query(
    `INSERT INTO "abExperiments" ("id","projectId","name","targetPath","salt","status","decisionStatus","startedAt","endedAt","maxEndAt","snoozeUntil",
       "notifiedAt","winnerVariant","bringState","copyProjectId","branch","baseCommitOid","controlReleaseSha","metricsSnapshot","updatedAt",
       "decisionPrevStatus","decisionLockedAt","createdBy")
     VALUES ($1,$2,$3,$4,'salt',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'u1')`,
    [
      o.id,
      o.projectId ?? "p1",
      o.name ?? "Hero principal",
      o.targetPath ?? "/",
      o.status ?? "running",
      o.decisionStatus ?? "none",
      o.startedAt ?? null,
      o.endedAt ?? null,
      o.maxEndAt ?? null,
      o.snoozeUntil ?? null,
      o.notifiedAt ?? null,
      o.winnerVariant ?? null,
      o.bringState ?? null,
      o.copyProjectId ?? null,
      o.branch ?? null,
      o.baseCommitOid ?? null,
      o.controlReleaseSha ?? null,
      o.metricsSnapshot === undefined ? null : JSON.stringify(o.metricsSnapshot),
      o.updatedAt ?? new Date(),
      o.decisionPrevStatus ?? null,
      o.decisionLockedAt ?? null,
    ],
  );
}
