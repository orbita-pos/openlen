// Idempotent SQL for `npm run ab-testing:migrate`, separated so PGlite tests execute
// the exact same DDL as production. Keep in step with lib/db/schema.ts
// (`abExperiments`, `abExperimentDaily`, `pageEvents.ab`, `formSubmissions.meta.ab`).
export const CREATE_AB_TESTING: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "abExperiments" (
    "id" text PRIMARY KEY,
    "projectId" text NOT NULL,
    "assistantId" text,
    "name" text NOT NULL,
    "hypothesis" text,
    "targetPath" text NOT NULL DEFAULT '/',
    "includeLocales" boolean NOT NULL DEFAULT false,
    "primaryMetric" text NOT NULL DEFAULT 'conversion_any',
    "splitBps" integer NOT NULL DEFAULT 5000,
    "salt" text NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "decisionStatus" text NOT NULL DEFAULT 'none',
    "copyProjectId" text,
    "branch" text,
    "baseCommitOid" text,
    "variantBCommitOid" text,
    "bringState" text,
    "controlReleaseSha" text,
    "experimentReleaseSha" text,
    "promotedReleaseSha" text,
    "winnerVariant" text,
    "metricsSnapshot" jsonb,
    "startedAt" timestamptz,
    "minEndAt" timestamptz,
    "snoozeUntil" timestamptz,
    "endedAt" timestamptz,
    "evaluatedAt" timestamptz,
    "notifiedAt" timestamptz,
    "decidedAt" timestamptz,
    "decidedBy" text,
    "createdBy" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "abExperiments_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "abExperiments_assistantId_assistants_id_fk"
      FOREIGN KEY ("assistantId") REFERENCES "assistants"("id") ON DELETE SET NULL
  );`,
  // Columns added after the table's first version (additive: a table an earlier run created gets them here).
  `ALTER TABLE "abExperiments" ADD COLUMN IF NOT EXISTS "maxEndAt" timestamptz;`,
  `ALTER TABLE "abExperiments" ADD COLUMN IF NOT EXISTS "decisionPrevStatus" text;`,
  `ALTER TABLE "abExperiments" ADD COLUMN IF NOT EXISTS "decisionLockedAt" timestamptz;`,
  // At most one live/draft experiment per (project, targetPath).
  `CREATE UNIQUE INDEX IF NOT EXISTS "abExperiments_active_target_idx"
    ON "abExperiments" ("projectId", "targetPath")
    WHERE "status" IN ('draft', 'running', 'winner_ready', 'inconclusive');`,
  `CREATE INDEX IF NOT EXISTS "abExperiments_running_idx"
    ON "abExperiments" ("status", "evaluatedAt")
    WHERE "status" = 'running';`,
  `CREATE INDEX IF NOT EXISTS "abExperiments_pending_decision_idx"
    ON "abExperiments" ("assistantId", "decisionStatus")
    WHERE "decisionStatus" = 'pending';`,
  `CREATE TABLE IF NOT EXISTS "abExperimentDaily" (
    "experimentId" text NOT NULL,
    "day" date NOT NULL,
    "variant" text NOT NULL,
    "views" integer NOT NULL DEFAULT 0,
    "clicks" integer NOT NULL DEFAULT 0,
    "conversions" integer NOT NULL DEFAULT 0,
    PRIMARY KEY ("experimentId", "day", "variant"),
    CONSTRAINT "abExperimentDaily_experimentId_abExperiments_id_fk"
      FOREIGN KEY ("experimentId") REFERENCES "abExperiments"("id") ON DELETE CASCADE
  );`,
  // Additive attribution column on pageEvents. Its partial index, and the one on formSubmissions, are built
  // CONCURRENTLY by `runAbTestingMigration` (see CREATE_AB_TESTING_CONCURRENT below).
  `ALTER TABLE "pageEvents" ADD COLUMN IF NOT EXISTS "ab" text;`,
];

// ─────────────────────────────────────────────────────────────────────────────
// The indexes on the HOT tables (review item 4). `pageEvents` takes an insert on every page view of every published
// site and `formSubmissions` the leads: a plain CREATE INDEX holds a lock that stops those writes until it is built,
// and the migration runs in the deploy. So they are built CONCURRENTLY, which cannot run inside a transaction block —
// each goes alone, on one connection (`runAbTestingMigration`), never inside BEGIN/COMMIT.
//
// A CONCURRENTLY build that is interrupted (a deploy killed, a lock timeout) leaves an INVALID index of the same name,
// and `IF NOT EXISTS` would then skip it forever: the runner drops an invalid one before building.
// ─────────────────────────────────────────────────────────────────────────────
export interface AbConcurrentIndex {
  readonly name: string;
  readonly sql: string;
}

export const CREATE_AB_TESTING_CONCURRENT: readonly AbConcurrentIndex[] = [
  {
    name: "pageEvents_projectId_ab_ts_idx",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "pageEvents_projectId_ab_ts_idx"
    ON "pageEvents" ("projectId", "ab", "ts")
    WHERE "ab" IS NOT NULL;`,
  },
  {
    name: "formSubmissions_projectId_ab_idx",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "formSubmissions_projectId_ab_idx"
    ON "formSubmissions" ("projectId", ("meta" ->> 'ab'))
    WHERE ("meta" ->> 'ab') IS NOT NULL;`,
  },
];

/** How long a DDL waits for a lock before it gives up (instead of making every insert queue behind IT). */
export const AB_LOCK_TIMEOUT = "5s";
/** Postgres' `lock_not_available`, what `lock_timeout` raises. */
const LOCK_NOT_AVAILABLE = "55P03";
const LOCK_ATTEMPTS = 5;

/** What the runner needs from ONE connection (a `pg` client or PGlite): the same session must see the `SET`. */
export interface MigrationClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Runs the whole migration on ONE connection, outside any transaction: `lock_timeout` first, the plain statements,
 *  then the hot-table indexes CONCURRENTLY. A statement that times out on a lock is retried a few times, with a growing
 *  pause; any other error goes up (the deploy stops before the swap, and the migration is idempotent: run it again). */
export async function runAbTestingMigration(
  client: MigrationClient,
  opts: { readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retrying = async (run: () => Promise<unknown>): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      try {
        await run();
        return;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code !== LOCK_NOT_AVAILABLE || attempt >= LOCK_ATTEMPTS) throw err;
        await sleep(attempt * 2_000);
      }
    }
  };

  await client.query(`SET lock_timeout = '${AB_LOCK_TIMEOUT}'`);
  for (const statement of CREATE_AB_TESTING) await retrying(() => client.query(statement));
  for (const index of CREATE_AB_TESTING_CONCURRENT) {
    await retrying(async () => {
      const state = await client.query(
        `SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`,
        [index.name],
      );
      if (state.rows[0]?.valid === false) await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${index.name}"`);
      await client.query(index.sql);
    });
  }
}
