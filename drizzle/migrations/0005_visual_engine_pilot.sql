-- Visual Engine pilot ledger. This is deliberately redacted telemetry, never
-- project storage: no user identity, brief, HTML, prompts, model response, or
-- provider error body belongs in these tables.

CREATE TABLE "visualEnginePilotBudgets" (
  "phase" text PRIMARY KEY,
  "limit" integer NOT NULL,
  "used" integer DEFAULT 0 NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "visualEnginePilotBudgets_nonnegative" CHECK ("limit" >= 0 AND "used" >= 0 AND "used" <= "limit")
);
--> statement-breakpoint
INSERT INTO "visualEnginePilotBudgets" ("phase", "limit", "used") VALUES
  ('2a', 75, 0), ('2b', 75, 0), ('2c', 150, 0)
ON CONFLICT ("phase") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "visualEnginePilotRuns" (
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
  "completedAt" timestamp,
  CONSTRAINT "visualEnginePilotRuns_phase_ordinal_unique" UNIQUE("phase", "ordinal")
);
--> statement-breakpoint
CREATE INDEX "visualEnginePilotRuns_phase_status_idx" ON "visualEnginePilotRuns" USING btree ("phase", "status");
--> statement-breakpoint
CREATE INDEX "visualEnginePilotRuns_createdAt_idx" ON "visualEnginePilotRuns" USING btree ("createdAt");
