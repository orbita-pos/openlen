import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const script = readFileSync(resolve(root, "scripts/visual-engine-pilot-migrate.ts"), "utf8");
const bundle = readFileSync(resolve(root, "scripts/build-migrations.mjs"), "utf8");
const history = readFileSync(resolve(root, "drizzle/migrations/0005_visual_engine_pilot.sql"), "utf8");
const schema = readFileSync(resolve(root, "lib/db/schema.ts"), "utf8");

describe("Visual Engine pilot deployment migration", () => {
  it("has idempotent DDL for the budget, ledger, constraint, indexes, and phase seeds", () => {
    for (const source of [script, history]) {
      expect(source).toContain('"visualEnginePilotBudgets"');
      expect(source).toContain('"visualEnginePilotRuns"');
      expect(source).toContain('"visualEnginePilotBudgets_nonnegative"');
      expect(source).toContain('"visualEnginePilotRuns_phase_ordinal_unique"');
      expect(source).toContain('"visualEnginePilotRuns_phase_status_idx"');
      expect(source).toContain('"visualEnginePilotRuns_createdAt_idx"');
      expect(source).toContain("('2a', 75, 0), ('2b', 75, 0), ('2c', 150, 0)");
    }
    expect(script).toContain("CREATE TABLE IF NOT EXISTS");
    expect(script).toContain("ON CONFLICT (\"phase\") DO NOTHING");
    expect(script).toContain("ADD CONSTRAINT");
    expect(script).toContain("EXCEPTION WHEN duplicate_object");
    expect(script).toContain("FROM pg_constraint");
    expect(script).toContain("conrelid = '\"visualEnginePilotRuns\"'::regclass");
    expect(script).toContain("CREATE INDEX IF NOT EXISTS");
  });

  it("bundles the migration after existing table setup and uses the same unique constraint name as the schema history", () => {
    expect(bundle).toContain('"visual-engine-pilot-migrate"');
    expect(bundle.indexOf('"visual-engine-pilot-migrate"')).toBeGreaterThan(bundle.indexOf('"versions-baseline-migrate"'));
    expect(schema).toContain('unique("visualEnginePilotRuns_phase_ordinal_unique")');
    expect(history).toContain('CONSTRAINT "visualEnginePilotRuns_phase_ordinal_unique" UNIQUE("phase", "ordinal")');
  });
});
