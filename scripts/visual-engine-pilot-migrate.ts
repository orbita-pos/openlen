// Deploy the redacted Visual Engine pilot ledger without `db:push`, which is
// blocked by unrelated schema drift. Keep this DDL in sync with
// drizzle/migrations/0005_visual_engine_pilot.sql and lib/db/schema.ts.
//
// Run locally: npm run visual-engine-pilot:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "visualEnginePilotBudgets" (
    "phase" text PRIMARY KEY,
    "limit" integer NOT NULL,
    "used" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
  );`);
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE "visualEnginePilotBudgets"
      ADD CONSTRAINT "visualEnginePilotBudgets_nonnegative"
      CHECK ("limit" >= 0 AND "used" >= 0 AND "used" <= "limit");
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS "visualEnginePilotRuns" (
    "id" text PRIMARY KEY NOT NULL,
    "phase" text NOT NULL,
    "ordinal" integer NOT NULL,
    "mode" text NOT NULL,
    "route" text NOT NULL,
    "templateId" text NOT NULL,
    "status" text NOT NULL,
    "reasonCode" text,
    "promptVersion" text,
    "contractVersion" text,
    "policyVersion" text,
    "taxonomyVersion" text,
    "modelVersion" text,
    "rateCardVersion" text,
    "inputTokens" integer,
    "outputTokens" integer,
    "thinkingTokens" integer,
    "cachedTokens" integer,
    "productionEquivalentCostMicromxn" integer,
    "observedPilotCostMicromxn" integer,
    "durationMs" integer,
    "criticVisualQualityScore" integer,
    "criticBriefAdherenceScore" integer,
    "criticFallback" boolean,
    "structuralFingerprintBefore" text,
    "structuralFingerprintAfter" text,
    "candidatePersisted" boolean DEFAULT false NOT NULL,
    "structuralInvariantPassed" boolean,
    "comparisonVerdict" text,
    "acceptedForbiddenSignalCount" integer,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "completedAt" timestamp
  );`);
  await db.execute(sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'visualEnginePilotRuns_phase_ordinal_unique'
        AND conrelid = '"visualEnginePilotRuns"'::regclass
    ) THEN
      ALTER TABLE "visualEnginePilotRuns"
        ADD CONSTRAINT "visualEnginePilotRuns_phase_ordinal_unique" UNIQUE("phase", "ordinal");
    END IF;
  END $$;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "visualEnginePilotRuns_phase_status_idx"
    ON "visualEnginePilotRuns" ("phase", "status");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "visualEnginePilotRuns_createdAt_idx"
    ON "visualEnginePilotRuns" ("createdAt");`);
  await db.execute(sql`INSERT INTO "visualEnginePilotBudgets" ("phase", "limit", "used") VALUES
    ('2a', 75, 0), ('2b', 75, 0), ('2c', 150, 0)
    ON CONFLICT ("phase") DO NOTHING;`);

  console.log("Visual Engine pilot ledger ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
