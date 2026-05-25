// One-shot DB bootstrap for the analytics tables.
//
// Drizzle's `db:generate` produced a migration file with phantom statements
// because the snapshot meta is out of sync with the live DB (the project
// uses `db:push` for prior schema changes, which doesn't update snapshots).
// Rather than reconcile the snapshots, this script applies ONLY the real
// diff for the analytics feature — idempotent (CREATE … IF NOT EXISTS +
// constraint try/catch), so re-runs are safe.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

interface Step {
  label: string;
  query: string;
  /** When true, "already exists" / "duplicate" errors are treated as success. */
  swallowExists?: boolean;
}

const STEPS: Step[] = [
  {
    label: "create table pageEvents",
    query: `
      CREATE TABLE IF NOT EXISTS "pageEvents" (
        "id" text PRIMARY KEY NOT NULL,
        "projectId" text NOT NULL,
        "type" text NOT NULL,
        "href" text,
        "linkLabel" text,
        "referrer" text,
        "country" text,
        "device" text,
        "browser" text,
        "uaHash" text,
        "ts" timestamp DEFAULT now() NOT NULL
      )
    `,
  },
  {
    label: "create table pageEventsDaily",
    query: `
      CREATE TABLE IF NOT EXISTS "pageEventsDaily" (
        "projectId" text NOT NULL,
        "day" date NOT NULL,
        "type" text NOT NULL,
        "href" text DEFAULT '' NOT NULL,
        "country" text DEFAULT '' NOT NULL,
        "device" text DEFAULT '' NOT NULL,
        "count" integer DEFAULT 0 NOT NULL,
        "uniques" integer DEFAULT 0 NOT NULL,
        CONSTRAINT "pageEventsDaily_projectId_day_type_href_country_device_pk"
          PRIMARY KEY("projectId","day","type","href","country","device")
      )
    `,
  },
  {
    label: "fk pageEvents → projects",
    swallowExists: true,
    query: `
      ALTER TABLE "pageEvents"
      ADD CONSTRAINT "pageEvents_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action
    `,
  },
  {
    label: "fk pageEventsDaily → projects",
    swallowExists: true,
    query: `
      ALTER TABLE "pageEventsDaily"
      ADD CONSTRAINT "pageEventsDaily_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action
    `,
  },
  {
    label: "index pageEvents (projectId, ts)",
    query: `
      CREATE INDEX IF NOT EXISTS "pageEvents_projectId_ts_idx"
      ON "pageEvents" USING btree ("projectId","ts")
    `,
  },
  {
    label: "index pageEvents (projectId, type, ts)",
    query: `
      CREATE INDEX IF NOT EXISTS "pageEvents_projectId_type_ts_idx"
      ON "pageEvents" USING btree ("projectId","type","ts")
    `,
  },
  {
    label: "index pageEventsDaily (projectId, day)",
    query: `
      CREATE INDEX IF NOT EXISTS "pageEventsDaily_projectId_day_idx"
      ON "pageEventsDaily" USING btree ("projectId","day")
    `,
  },
];

async function runStep(step: Step): Promise<void> {
  try {
    await db.execute(sql.raw(step.query));
    // eslint-disable-next-line no-console
    console.log(`✓ ${step.label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      step.swallowExists &&
      (/already exists/i.test(msg) || /duplicate/i.test(msg))
    ) {
      // eslint-disable-next-line no-console
      console.log(`· ${step.label} — already present, skipped`);
      return;
    }
    throw err;
  }
}

async function verify(): Promise<void> {
  const res = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('pageEvents', 'pageEventsDaily')
    ORDER BY table_name
  `);
  const rows = res.rows ?? res;
  // eslint-disable-next-line no-console
  console.log(`\nVerification — tables present:`, rows);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Bootstrapping analytics tables…\n`);
  for (const step of STEPS) {
    await runStep(step);
  }
  await verify();
  // eslint-disable-next-line no-console
  console.log(`\nDone.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`\nBootstrap FAILED:`, err);
    process.exit(1);
  });
