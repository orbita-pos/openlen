import { describe, expect, it, vi } from "vitest";
import {
  runVisualEngine2CSmoke,
  scoreVisualEngine2CPilot,
  validateVisualEngine2CReviewCoverage,
  validateVisualEngine2CSmokeGuard,
} from "./visual-engine-2c-eval";

const valid = {
  mode: "shadow", authorization: "AUTHORIZED_2C_SMOKE_ONCE", commitSha: "a".repeat(40), qualificationCommitSha: "a".repeat(40), qualificationValid: true,
  quota: { limit: 150, used: 0, existingRuns: 0 }, rateCardComplete: true, budgetMicromxn: 30_000_000,
};

describe("Visual Engine 2C paid gate", () => {
  it("accepts only the exact one-time closed gate", () => {
    expect(validateVisualEngine2CSmokeGuard(valid)).toEqual({ ok: true });
    for (const patch of [
      { mode: "on" }, { authorization: "wrong" }, { qualificationValid: false }, { qualificationCommitSha: "b".repeat(40) },
      { quota: { limit: 150, used: 1, existingRuns: 0 } }, { quota: { limit: 150, used: 0, existingRuns: 1 } },
      { rateCardComplete: false }, { budgetMicromxn: 30_000_001 },
    ]) expect(validateVisualEngine2CSmokeGuard({ ...valid, ...patch })).toMatchObject({ ok: false });
  });

  it("rechecks HEAD/quota before reserving exactly 15 sequential rows", async () => {
    const order: string[] = [];
    const reserve = vi.fn(async (index: number) => { order.push(`reserve:${index}`); return { ok: true as const, id: `run-${index}`, ordinal: index + 1 }; });
    const complete = vi.fn(async (id: string) => { order.push(`complete:${id}`); });
    const result = await runVisualEngine2CSmoke(valid, {
      currentHead: vi.fn(async () => { order.push("head"); return "a".repeat(40); }),
      currentQuota: vi.fn(async () => { order.push("quota"); return { limit: 150, used: 0, existingRuns: 0 }; }),
      reserve, complete,
      evaluate: vi.fn(async (index: number) => ({ providerCalls: index < 6 ? 1 : index < 12 ? 3 : 1, costMicromxn: 1000, status: index < 12 ? "adapted" as const : "fallback" as const })),
    });
    expect(result).toMatchObject({ ok: true, reservations: 15, providerCalls: 27, totalCostMicromxn: 15_000 });
    expect(reserve).toHaveBeenCalledTimes(15); expect(complete).toHaveBeenCalledTimes(15);
    expect(order.slice(0, 2)).toEqual(["head", "quota"]);
    expect(order.indexOf("reserve:0")).toBeGreaterThan(order.indexOf("quota"));
  });

  it("settles a reserved provider failure once at the conservative row ceiling without retry", async () => {
    const evaluate = vi.fn(async (index: number) => {
      if (index === 0) throw new Error("provider body must stay redacted");
      return { providerCalls: index < 6 ? 1 : index < 12 ? 3 : 1, costMicromxn: 1000, status: "adapted" as const };
    });
    const complete = vi.fn(async () => undefined);
    const result = await runVisualEngine2CSmoke(valid, {
      currentHead: async () => "a".repeat(40),
      currentQuota: async () => ({ limit: 150, used: 0, existingRuns: 0 }),
      reserve: async (index) => ({ ok: true, id: `run-${index}`, ordinal: index + 1 }),
      evaluate,
      complete,
    });
    expect(result).toMatchObject({ ok: true, reservations: 15, providerCalls: 27, totalCostMicromxn: 2_014_000 });
    expect(evaluate).toHaveBeenCalledTimes(15);
    expect(complete).toHaveBeenCalledTimes(15);
    expect(complete).toHaveBeenNthCalledWith(1, "run-0", { providerCalls: 1, costMicromxn: 2_000_000, status: "failed" });
  });

  it("fails scorecard unless integrity, cost and human preference gates all pass", () => {
    const rows = Array.from({ length: 15 }, (_, index) => ({
      acceptedRepair: index < 6,
      healthyReplacement: false,
      technicalFailure: false,
      allowlistViolation: false,
      structureViolation: false,
      copyViolation: false,
      roleViolation: false,
      navigationViolation: false,
      identityViolation: false,
      costMicromxn: 1000,
    }));
    const decisions = Array.from({ length: 6 }, () => "tie" as const);
    expect(scoreVisualEngine2CPilot(rows, decisions, { budgetMicromxn: 30_000_000 })).toMatchObject({ passed: true, costCoverage: 1, humanPreferredOrTiedRate: 1 });
    expect(scoreVisualEngine2CPilot(rows.map((row, index) => index === 0 ? { ...row, allowlistViolation: true } : row), decisions, { budgetMicromxn: 30_000_000 }).passed).toBe(false);
    for (const field of ["structureViolation", "copyViolation", "roleViolation", "navigationViolation", "identityViolation"] as const) {
      expect(scoreVisualEngine2CPilot(rows.map((row, index) => index === 0 ? { ...row, [field]: true } : row), decisions, { budgetMicromxn: 30_000_000 }).passed).toBe(false);
    }
    expect(scoreVisualEngine2CPilot(rows, ["baseline", "baseline", ...decisions.slice(2)], { budgetMicromxn: 30_000_000 }).passed).toBe(false);
  });

  it("reviews every accepted repair and no healthy or rejected row", () => {
    const runs = Array.from({ length: 15 }, (_, index) => ({
      pilotRunId: `run-${index}`,
      ordinal: index + 1,
      acceptedRepair: index >= 6 && index < 12,
    }));
    const source = runs.slice(6, 12).map((run) => ({ comparisonId: `comparison-${run.ordinal}`, pilotRunId: run.pilotRunId }));
    expect(() => validateVisualEngine2CReviewCoverage(source, runs)).not.toThrow();
    expect(() => validateVisualEngine2CReviewCoverage(source.slice(1), runs)).toThrow("review evidence coverage mismatch");
    expect(() => validateVisualEngine2CReviewCoverage([...source, { comparisonId: "healthy", pilotRunId: "run-0" }], runs)).toThrow("accepted repairs only");
  });
});
