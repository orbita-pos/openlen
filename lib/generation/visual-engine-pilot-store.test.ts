import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  completeVisualEnginePilotRun,
  markStaleVisualEnginePilotRuns,
  recordVisualEnginePilotComparison,
  reserveVisualEnginePilotRun,
  type PilotReasonCode,
} from "./visual-engine-pilot-store";

const migrationPath = resolve(process.cwd(), "drizzle/migrations/0005_visual_engine_pilot.sql");

function reservationDeps(result: unknown) {
  const execute = vi.fn().mockResolvedValue(result);
  return { execute, createId: () => "run-1" };
}

describe("Visual Engine pilot schema", () => {
  it("declares only redacted scalar pilot telemetry and idempotent phase budgets", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "visualEnginePilotBudgets"');
    expect(migration).toContain("('2a', 75, 0), ('2b', 75, 0), ('2c', 150, 0)");
    expect(migration).toContain('ON CONFLICT ("phase") DO NOTHING');
    expect(migration).toContain('CREATE TABLE "visualEnginePilotRuns"');
    expect(migration).toContain('"candidatePersisted" boolean DEFAULT false NOT NULL');
    expect(migration).toContain('"structuralInvariantPassed" boolean');
    expect(migration).toContain('UNIQUE("phase", "ordinal")');
    expect(migration).toContain('CREATE INDEX "visualEnginePilotRuns_phase_status_idx"');
    expect(migration).toContain('CREATE INDEX "visualEnginePilotRuns_createdAt_idx"');
    for (const forbidden of ["userId", "projectId", "brief", "html", "payload", "jsonb", "response", "errorBody"]) {
      expect(migration).not.toContain(`"${forbidden}"`);
    }
  });
});

describe("reserveVisualEnginePilotRun", () => {
  it("uses one compiled PostgreSQL CTE for the quota update and started row", async () => {
    const deps = reservationDeps({ rows: [{ id: "run-1", ordinal: 4 }] });
    const result = await reserveVisualEnginePilotRun({
      phase: "2a", mode: "shadow", route: "template_skeleton", templateId: "coloring-base",
    }, deps);

    expect(result).toEqual({ ok: true, id: "run-1", ordinal: 4 });
    expect(deps.execute).toHaveBeenCalledTimes(1);
    const compiled = new PgDialect().sqlToQuery(deps.execute.mock.calls[0]![0]);
    const normalized = compiled.sql.replace(/\s+/g, " ").trim().toLowerCase();
    expect(normalized).toMatch(/^with reserved as \( update "visualenginepilotbudgets"/);
    expect(normalized).toContain('insert into "visualenginepilotruns"');
    expect(normalized).not.toContain(";");
  });

  it("fails closed on quota exhaustion without retrying", async () => {
    const deps = reservationDeps({ rows: [] });
    await expect(reserveVisualEnginePilotRun({
      phase: "2a", mode: "shadow", route: "template_skeleton", templateId: "coloring-base",
    }, deps)).resolves.toEqual({ ok: false, code: "pilot_quota_exhausted" });
    expect(deps.execute).toHaveBeenCalledTimes(1);
  });

  it("never returns a database error body to a caller", async () => {
    const deps = reservationDeps({ rows: [] });
    deps.execute.mockRejectedValueOnce(new Error("database detail: secret-query-value"));
    await expect(reserveVisualEnginePilotRun({
      phase: "2a", mode: "shadow", route: "template_skeleton", templateId: "coloring-base",
    }, deps)).rejects.toThrow("Visual Engine pilot telemetry unavailable");
  });
});

describe("pilot run updates", () => {
  it.each([
    "insufficient_style_hooks",
    "invalid_html",
    "invalid_inventory",
    "cannot_remove_forbidden_signal",
    "cannot_add_required_signal",
    "asset_slot_unavailable",
    "hook_property_not_allowed",
    "unsupported_section_role",
    "section_inventory_stale",
    "section_fragment_unavailable",
    "section_fragment_stale",
    "section_role_coverage_failed",
    "inherited_copy_leak",
  ] as const satisfies readonly PilotReasonCode[])("persists typed adaptation reason %s without a raw message", async (reasonCode) => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await completeVisualEnginePilotRun("run-1", { status: "fallback", reasonCode }, { execute });
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(compiled.params).toContain(reasonCode);
  });

  it("updates only allowlisted scalar completion fields", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await completeVisualEnginePilotRun("run-1", {
      status: "fallback", reasonCode: "provider_timeout", promptVersion: "creative-prompt/1.0",
      contractVersion: "creative-direction/1.0", policyVersion: "creative-policy/1.0", taxonomyVersion: "taxonomy/1.0",
      modelVersion: "gemini-test", rateCardVersion: "rate-card/1", inputTokens: 10, cachedTokens: 2,
      outputTokens: 4, thinkingTokens: 1, productionEquivalentCostMicromxn: 12, observedPilotCostMicromxn: 20,
      durationMs: 30, criticVisualQualityScore: 4, criticBriefAdherenceScore: 5, criticFallback: false,
      structuralFingerprintBefore: "before", structuralFingerprintAfter: "after", structuralInvariantPassed: true,
      candidatePersisted: false,
    }, { execute });
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(compiled.sql.replace(/\s+/g, " ").trim().toLowerCase()).toContain('update "visualenginepilotruns" set');
    for (const forbidden of ["brief", "html", "projectId", "userId", "response", "payload"]) {
      expect(compiled.sql).not.toContain(forbidden);
    }
  });

  it("completes only a started row so terminal outcomes cannot be overwritten", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 1 });
    await completeVisualEnginePilotRun("run-1", { status: "adapted", candidatePersisted: false }, { execute });
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    const normalized = compiled.sql.replace(/\s+/g, " ").trim().toLowerCase();

    expect(normalized).toContain('where "id" = $');
    expect(normalized).toContain('and "status" = \'started\'');
  });

  it("records a scalar human comparison and abandons stale starts without reclaiming quota", async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
    await recordVisualEnginePilotComparison("run-1", { verdict: "candidate", acceptedForbiddenSignalCount: 0 }, { execute });
    await expect(markStaleVisualEnginePilotRuns(new Date("2026-08-07T12:00:00.000Z"), { execute }))
      .resolves.toBe(3);
    const comparison = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    const stale = new PgDialect().sqlToQuery(execute.mock.calls[1]![0]);
    expect(comparison.sql).toContain('"comparisonVerdict"');
    expect(stale.sql).toContain("'abandoned'");
    expect(stale.sql).not.toContain('"visualEnginePilotBudgets"');
  });
});
