import { describe, expect, it, vi } from "vitest";
import { SELECTOR_CASES } from "./selector-cases";
import { SELECTOR_HOLDOUT_CASES } from "./selector-holdout-cases";
import {
  buildVisualEngine2APool,
  preflightVisualEngine2A,
  scoreVisualEngine2APilot,
  neutralizeVisibleCopy,
  buildRollbackEvidence,
  validateRollbackEvidence,
  generateVisualEngine2AEvidence,
} from "./visual-engine-2a-eval";

describe("Visual Engine 2A pilot", () => {
  it("builds and sorts all 150 pre-output candidates", () => {
    const pool = buildVisualEngine2APool([...SELECTOR_CASES, ...SELECTOR_HOLDOUT_CASES]);
    expect(pool).toHaveLength(150);
    expect(pool.map((row) => `${row.caseId}/${row.scenarioId}`)).toEqual(
      [...pool].map((row) => `${row.caseId}/${row.scenarioId}`).sort(),
    );
  });

  it("stops before reservation when fewer than 75 candidates are eligible", async () => {
    const reserve = vi.fn();
    const result = await preflightVisualEngine2A({
      cases: [...SELECTOR_CASES, ...SELECTOR_HOLDOUT_CASES],
      templates: [],
      select: async () => ({ ok: true, route: "template_full", templateId: "t" }),
      reserve,
    });
    expect(result.ok).toBe(false);
    expect(result.counts).toMatchObject({ pool: 150, analyzed: 150, templateSkeleton: 0 });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("caps the sorted safe skeleton set at exactly 75", async () => {
    const result = await preflightVisualEngine2A({
      cases: [...SELECTOR_CASES, ...SELECTOR_HOLDOUT_CASES],
      templates: [],
      select: async (_brief, _templates, row) => ({ ok: true, route: "template_skeleton", templateId: row.caseId }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eligible).toHaveLength(75);
  });

  it("enforces every approved gate and denominator", () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      started: true,
      technicalSuccess: index < 72,
      comparable: index < 70,
      verdict: index < 63 ? "candidate" as const : index < 70 ? "tie" as const : "invalid" as const,
      structuralFailure: false,
      partialPersistenceFailure: false,
      acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: 399_999,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score).toMatchObject({
      started: 75,
      technicalSuccessRate: 0.96,
      visuallyPreferredRate: 0.9,
      structuralFailures: 0,
      partialPersistenceFailures: 0,
      acceptedForbiddenSignals: 0,
      rollbackVerified: true,
      passed: true,
    });
    expect(score.requiredVisualWins).toBe(63);
  });

  it("treats ties as losses and requires mean cost strictly below 400000", () => {
    const rows = Array.from({ length: 75 }, () => ({
      started: true, technicalSuccess: true, comparable: true,
      verdict: "tie" as const, structuralFailure: false,
      partialPersistenceFailure: false, acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: 400_000,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score.visuallyPreferredRate).toBe(0);
    expect(score.passed).toBe(false);
    expect(score.failures).toEqual(expect.arrayContaining(["visualPreference", "meanCost"]));
  });

  it("neutralizes visible copy without changing markup or attributes", () => {
    expect(neutralizeVisibleCopy('<main aria-label="Keep"><h1>Hello world</h1><script>x()</script></main>'))
      .toBe('<main aria-label="Keep"><h1>Neutral copy</h1><script>x()</script></main>');
  });

  it("accepts rollback evidence only for byte-equal unset/off/shadow delivery with an isolated candidate", () => {
    const evidence = buildRollbackEvidence({
      fixture: { brief: "fixture" }, unset: "same", off: "same", shadow: "same", candidateJobs: 1,
    });
    expect(evidence.verified).toBe(true);
    expect(validateRollbackEvidence(evidence, evidence.fixtureSha256)).toBe(true);
    expect(() => buildRollbackEvidence({
      fixture: { brief: "fixture" }, unset: "same", off: "changed", shadow: "same", candidateJobs: 1,
    })).toThrow(/rollback/i);
  });

  it("runs exactly one critic and one scalar completion per reserved adaptation", async () => {
    const eligible = Array.from({ length: 75 }, (_, index) => ({
      caseId: `case-${String(index).padStart(2, "0")}`, scenarioId: "plain",
      language: "en" as const, brief: "safe fixture", forbiddenSignals: [], templateId: "template",
    }));
    const critic = vi.fn(async () => ({
      visualQuality: 8, briefAdherence: 9, issues: [], shouldRegenerate: false,
      regenerationFeedback: "", fallback: false,
      usage: { inputTokens: 2, outputTokens: 3, cachedTokens: 0, thinkingTokens: 1 },
    }));
    const complete = vi.fn(async () => undefined);
    const result = await generateVisualEngine2AEvidence({
      eligible, rateCardVersion: "test/1",
      calculateCosts: () => ({ productionEquivalentCostMicromxn: 10, observedPilotCostMicromxn: 12 }),
      deps: {
        reserve: async (row) => ({ ok: true, id: `run-${row.caseId}` }),
        baseline: async () => ({ html: "<main>Baseline</main>" }),
        adapt: async () => ({
          ok: true, html: "<main>Candidate</main>", durationMs: 5,
          usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 1, thinkingTokens: 2 },
          structuralFingerprintBefore: "sha256:" + "a".repeat(64),
          structuralFingerprintAfter: "sha256:" + "a".repeat(64),
          promptVersion: "prompt/1", contractVersion: "creative-direction/1.0",
          policyVersion: "policy/1", taxonomyVersion: "taxonomy/1", modelVersion: "model/1",
        }),
        critique: critic,
        render: async () => Uint8Array.from([1, 2, 3]),
        writeEvidence: async () => undefined,
        complete,
      },
    });
    expect(result).toEqual({ started: 75, evidence: 75 });
    expect(critic).toHaveBeenCalledTimes(75);
    expect(complete).toHaveBeenCalledTimes(75);
    expect(complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      candidatePersisted: false, productionEquivalentCostMicromxn: 10,
    }));
  });
});
