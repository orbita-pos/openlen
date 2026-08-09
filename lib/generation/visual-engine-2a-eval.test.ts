import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "./visual-engine-2a-cohort";
import {
  buildVisualEngine2ASmokeRows,
  validateVisualEngine2AEvidenceSize,
  buildVisualEngine2APool,
  preflightVisualEngine2A,
  scoreVisualEngine2APilot,
  neutralizeVisibleCopy,
  buildRollbackEvidence,
  validateRollbackEvidence,
  generateVisualEngine2AEvidence,
  prepareVisualEngine2ABuilds,
  captureVisualEngine2ARollbackModes,
  captureVisualEngineRollbackModes,
} from "./visual-engine-2a-eval";
import { writeVisualEngine2ARollbackEvidence } from "@/scripts/visual-engine-2a-rollback-check";
import { createPilotBudgetGuard } from "./visual-engine-pilot-budget";

describe("Visual Engine 2A pilot", () => {
  it("preloads the server-only shim for every Task 10 operational CLI", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const commands = [
      "generation:visual-engine-2a:eval",
      "generation:visual-engine-2a:review",
      "generation:visual-engine-2a:scorecard",
      "generation:visual-engine-2a:rollback-check",
    ];

    for (const command of commands) {
      const script = packageJson.scripts[command];
      expect(script).toContain("--require ./scripts/test-node-server-only-shim.cjs");
      expect(script.indexOf("--require ./scripts/test-node-server-only-shim.cjs"))
        .toBeLessThan(script.indexOf("scripts/visual-engine-2a-"));
    }
  });

  it("writes rollback evidence below the exact ignored path when its parent is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "openlen-visual-engine-2a-"));
    const evidence = { verified: true, fixtureSha256: "fixture" };
    try {
      const outputPath = await writeVisualEngine2ARollbackEvidence(evidence, root);
      expect(outputPath).toBe(join(root, "scratch", "visual-engine-2a", "rollback-evidence.json"));
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(evidence);
      expect(await readdir(join(root, "scratch"))).toEqual(["visual-engine-2a"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds and sorts the 75 cohort scenario rows with qualification provenance", () => {
    const pool = buildVisualEngine2APool(VISUAL_ENGINE_2A_PILOT_CASES);
    expect(pool).toHaveLength(75);
    expect(pool.map((row) => `${row.caseId}/${row.scenarioId}`)).toEqual(
      [...pool].map((row) => `${row.caseId}/${row.scenarioId}`).sort(),
    );
    expect(pool[0]).toMatchObject({
      datasetVersion: "visual-engine-2a-cohort/1.0",
      archetype: "restaurant_hospitality",
      allowedSkeletonTemplateIds: ["cafe-tramonto"],
    });
  });

  it("reduces a qualified cohort to one plain smoke row per case", () => {
    const qualified = buildVisualEngine2APool(VISUAL_ENGINE_2A_PILOT_CASES).map((row) => ({
      ...row,
      templateId: row.allowedSkeletonTemplateIds[0],
    }));

    const smoke = buildVisualEngine2ASmokeRows(qualified);

    expect(smoke).toHaveLength(15);
    expect(new Set(smoke.map((row) => row.caseId)).size).toBe(15);
    expect(smoke.every((row) => row.scenarioId === "plain")).toBe(true);
  });

  it("accepts only the declared full or smoke evidence cardinality", () => {
    expect(() => validateVisualEngine2AEvidenceSize(15, 15)).not.toThrow();
    expect(() => validateVisualEngine2AEvidenceSize(75, 75)).not.toThrow();
    expect(() => validateVisualEngine2AEvidenceSize(14, 15)).toThrow("exactly 15");
    expect(() => validateVisualEngine2AEvidenceSize(15, 75)).toThrow("exactly 75");
  });

  it("stops before DB reservation when a smoke row cannot fit the paid budget", async () => {
    const eligible = buildVisualEngine2ASmokeRows(
      buildVisualEngine2APool(VISUAL_ENGINE_2A_PILOT_CASES).map((row) => ({
        ...row,
        templateId: row.allowedSkeletonTemplateIds[0],
      })),
    );
    const reserve = vi.fn();

    const result = await generateVisualEngine2AEvidence({
      eligible,
      expectedSize: 15,
      rateCardVersion: "test/1",
      calculateCosts: () => ({ productionEquivalentCostMicromxn: 1, observedPilotCostMicromxn: 1 }),
      budget: {
        guard: createPilotBudgetGuard(7_000_000),
        maximumRowCostMicromxn: 8_000_000,
      },
      deps: {
        reserve,
        baseline: vi.fn(), adapt: vi.fn(), critique: vi.fn(), render: vi.fn(),
        writeEvidence: vi.fn(), complete: vi.fn(),
      },
    });

    expect(result).toEqual({ started: 0, evidence: 0, budgetExhausted: true });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("stops before reservation when fewer than 75 candidates are eligible", async () => {
    const result = await preflightVisualEngine2A({
      cases: VISUAL_ENGINE_2A_PILOT_CASES,
      templates: [],
      select: async () => ({ ok: true, route: "template_full", templateId: "t" }),
    });
    expect(result.ok).toBe(false);
    expect(result.counts).toMatchObject({ pool: 75, analyzed: 75, templateSkeleton: 0 });
  });

  it("caps the sorted safe skeleton set at exactly 75", async () => {
    const result = await preflightVisualEngine2A({
      cases: VISUAL_ENGINE_2A_PILOT_CASES,
      templates: [],
      select: async (_brief, _templates, row) => ({ ok: true, route: "template_skeleton", templateId: row.allowedSkeletonTemplateIds![0] }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eligible).toHaveLength(75);
  });

  it("rejects a skeleton choice outside the cohort allowlist before live work", async () => {
    const result = await preflightVisualEngine2A({
      cases: VISUAL_ENGINE_2A_PILOT_CASES,
      templates: [],
      select: async () => ({ ok: true, route: "template_skeleton", templateId: "not-allowlisted" }),
    });
    expect(result).toMatchObject({ ok: false, code: "insufficient_eligible_cases", counts: { pool: 75, templateSkeleton: 0, selectionFailures: 75 } });
  });

  it("enforces every approved gate and denominator", () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      started: true,
      technicalSuccess: index < 72,
      comparable: index < 72,
      verdict: index < 65 ? "candidate" as const : index < 72 ? "tie" as const : null,
      structuralFailure: false,
      partialPersistenceFailure: false,
      acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: 399_999,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score).toMatchObject({
      started: 75,
      technicalSuccessRate: 0.96,
      reviewed: 72,
      expectedReviews: 72,
      unreviewed: 0,
      invalidReviews: 0,
      comparable: 72,
      structuralFailures: 0,
      partialPersistenceFailures: 0,
      acceptedForbiddenSignals: 0,
      rollbackVerified: true,
      passed: true,
    });
    expect(score.requiredVisualWins).toBe(65);
  });

  it("fails when technically successful rows have not been reviewed", () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      started: true, technicalSuccess: index < 72, comparable: false,
      verdict: null,
      structuralFailure: false, partialPersistenceFailure: false,
      acceptedForbiddenSignals: 0, productionEquivalentCostMicromxn: 1,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score).toMatchObject({ reviewed: 0, expectedReviews: 72, unreviewed: 72, comparable: 0, passed: false });
    expect(score.failures).toEqual(expect.arrayContaining(["reviewCoverage", "visualPreference"]));
  });

  it("fails an explicit invalid review instead of dropping it from the denominator", () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      started: true, technicalSuccess: index < 72, comparable: index < 71,
      verdict: index < 71 ? "candidate" as const : index === 71 ? "invalid" as const : null,
      structuralFailure: false, partialPersistenceFailure: false,
      acceptedForbiddenSignals: 0, productionEquivalentCostMicromxn: 1,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score).toMatchObject({ reviewed: 72, expectedReviews: 72, unreviewed: 0, invalidReviews: 1, comparable: 71, passed: false });
    expect(score.failures).toContain("invalidReview");
  });

  it("keeps ties in the comparable denominator as non-wins at the ninety-percent boundary", () => {
    const make = (wins: number) => Array.from({ length: 75 }, (_, index) => ({
      started: true, technicalSuccess: index < 72, comparable: index < 72,
      verdict: index < wins ? "candidate" as const : index < 72 ? "tie" as const : null,
      structuralFailure: false, partialPersistenceFailure: false,
      acceptedForbiddenSignals: 0, productionEquivalentCostMicromxn: 1,
    }));
    expect(scoreVisualEngine2APilot(make(65), { verified: true })).toMatchObject({ comparable: 72, candidateWins: 65, requiredVisualWins: 65, passed: true });
    expect(scoreVisualEngine2APilot(make(64), { verified: true })).toMatchObject({ comparable: 72, candidateWins: 64, requiredVisualWins: 65, passed: false });
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

  it.each([
    ["null", null],
    ["missing", undefined],
    ["non-finite", Number.NaN],
    ["negative", -1],
    ["fractional", 0.5],
  ])("fails incomplete production-equivalent cost coverage for a %s value", (_label, invalidCost) => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      started: true, technicalSuccess: index < 72,
      verdict: index < 65 ? "candidate" as const : index < 72 ? "tie" as const : null,
      structuralFailure: false, partialPersistenceFailure: false, acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: index === 74 ? invalidCost : 0,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score).toMatchObject({ costRowsRecorded: 74, costRowsMissing: 1, passed: false });
    expect(score.failures).toContain("costCoverage");
  });

  it("accepts an explicit zero cost and includes recorded technical failures in cost coverage", () => {
    const rows = Array.from({ length: 75 }, (_, index) => ({
      started: true, technicalSuccess: index < 72,
      verdict: index < 65 ? "candidate" as const : index < 72 ? "tie" as const : null,
      structuralFailure: false, partialPersistenceFailure: false, acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: index === 74 ? 0 : 1,
    }));
    const score = scoreVisualEngine2APilot(rows, { verified: true });
    expect(score).toMatchObject({
      costRowsRecorded: 75, costRowsMissing: 0,
      meanProductionEquivalentCostMicromxn: 74 / 75,
      passed: true,
    });
    expect(score.failures).not.toContain("costCoverage");
  });

  it("neutralizes visible copy without changing markup or attributes", () => {
    expect(neutralizeVisibleCopy('<main aria-label="Keep"><h1>Hello world</h1><script>x()</script></main>'))
      .toBe('<main aria-label="Keep"><h1>Neutral copy</h1><script>x()</script></main>');
  });

  it("accepts rollback evidence only for deep-equal delivery artifacts and one isolated shadow candidate", () => {
    const delivery = {
      selectedTemplateId: "weighted", finalizedHtml: "same",
      previewSequence: ["preview:same"], projectData: { html: "same" }, creditDelta: 3,
      creativeCalls: 0, pilotReserveCalls: 0, pilotCompleteCalls: 0, candidateJobs: 0,
    };
    const evidence = buildRollbackEvidence({
      fixture: { brief: "fixture" }, unset: delivery, off: delivery,
      shadow: { ...delivery, creativeCalls: 1, pilotReserveCalls: 1, pilotCompleteCalls: 1, candidateJobs: 1 },
    });
    expect(evidence.verified).toBe(true);
    expect(validateRollbackEvidence(evidence, evidence.fixtureSha256)).toBe(true);
    const mismatches = [
      { selectedTemplateId: "other" },
      { previewSequence: ["preview:other"] },
      { projectData: { html: "same", generation: { unexpected: true } } },
      { creditDelta: 4 },
      { creativeCalls: 1 },
      { pilotReserveCalls: 1 },
      { pilotCompleteCalls: 1 },
    ];
    for (const mismatch of mismatches) {
      expect(() => buildRollbackEvidence({
        fixture: { brief: "fixture" }, unset: delivery, off: { ...delivery, ...mismatch },
        shadow: { ...delivery, creativeCalls: 1, pilotReserveCalls: 1, pilotCompleteCalls: 1, candidateJobs: 1 },
      })).toThrow(/rollback/i);
    }
    expect(() => buildRollbackEvidence({
      fixture: { brief: "fixture" }, unset: delivery, off: delivery,
      shadow: { ...delivery, projectData: { html: "other" }, creativeCalls: 1, pilotReserveCalls: 1, pilotCompleteCalls: 1, candidateJobs: 1 },
    })).toThrow(/rollback/i);
  });

  it("runs rollback delivery under true unset, off and shadow env states and restores the caller env", async () => {
    const previous = process.env.OPENLEN_VISUAL_ENGINE;
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    const observed: Array<string | undefined> = [];
    try {
      const result = await captureVisualEngine2ARollbackModes(async () => {
        observed.push(process.env.OPENLEN_VISUAL_ENGINE);
        return { state: process.env.OPENLEN_VISUAL_ENGINE ?? "unset" };
      });
      expect(observed).toEqual([undefined, "off", "shadow"]);
      expect(result).toEqual({ unset: { state: "unset" }, off: { state: "off" }, shadow: { state: "shadow" } });
      expect(process.env.OPENLEN_VISUAL_ENGINE).toBe("skeleton");
    } finally {
      if (previous === undefined) delete process.env.OPENLEN_VISUAL_ENGINE;
      else process.env.OPENLEN_VISUAL_ENGINE = previous;
    }
  });

  it("captures all five Visual Engine delivery modes and restores the caller env", async () => {
    const previous = process.env.OPENLEN_VISUAL_ENGINE;
    process.env.OPENLEN_VISUAL_ENGINE = "skeleton";
    try {
      const result = await captureVisualEngineRollbackModes(async () => process.env.OPENLEN_VISUAL_ENGINE ?? "unset");
      expect(result).toEqual({ unset: "unset", off: "off", shadow: "shadow", skeleton: "skeleton", composition: "composition" });
      expect(process.env.OPENLEN_VISUAL_ENGINE).toBe("skeleton");
    } finally {
      if (previous === undefined) delete process.env.OPENLEN_VISUAL_ENGINE;
      else process.env.OPENLEN_VISUAL_ENGINE = previous;
    }
  });

  it("rejects a shadow candidate that reserves pilot quota but never completes it", () => {
    const delivery = {
      selectedTemplateId: "weighted", finalizedHtml: "same",
      previewSequence: ["preview:same"], projectData: { html: "same" }, creditDelta: 3,
      creativeCalls: 0, pilotReserveCalls: 0, pilotCompleteCalls: 0, candidateJobs: 0,
    };
    expect(() => buildRollbackEvidence({
      fixture: { brief: "fixture" }, unset: delivery, off: delivery,
      shadow: {
        ...delivery, creativeCalls: 1, pilotReserveCalls: 1, pilotCompleteCalls: 0, candidateJobs: 1,
      },
    })).toThrow(/rollback/i);
  });

  it("runs exactly one critic and one scalar completion per reserved adaptation", async () => {
    const eligible = Array.from({ length: 75 }, (_, index) => ({
      caseId: `case-${String(index).padStart(2, "0")}`, scenarioId: "plain",
      datasetVersion: "visual-engine-2a-cohort/1.0" as const, archetype: "technical_saas" as const,
      language: "en" as const, brief: "safe fixture", forbiddenSignals: [], allowedSkeletonTemplateIds: ["template"], templateId: "template",
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

  it("scores 72 adapted rows plus three paid provider failures without structural failures", async () => {
    const eligible = Array.from({ length: 75 }, (_, index) => ({
      caseId: `case-${String(index).padStart(2, "0")}`, scenarioId: "plain",
      datasetVersion: "visual-engine-2a-cohort/1.0" as const, archetype: "technical_saas" as const,
      language: "en" as const, brief: "safe fixture", forbiddenSignals: [], allowedSkeletonTemplateIds: ["template"], templateId: "template",
    }));
    const completions: Array<Parameters<Parameters<typeof generateVisualEngine2AEvidence>[0]["deps"]["complete"]>[1]> = [];
    const paidFailureUsage = { inputTokens: 7, outputTokens: 3, cachedTokens: 1, thinkingTokens: 2 };
    const result = await generateVisualEngine2AEvidence({
      eligible, rateCardVersion: "test/1",
      calculateCosts: (creative, critic) => ({
        productionEquivalentCostMicromxn: creative.inputTokens + creative.outputTokens + critic.inputTokens + critic.outputTokens,
        observedPilotCostMicromxn: creative.inputTokens + creative.outputTokens + critic.inputTokens + critic.outputTokens,
      }),
      deps: {
        reserve: async (row) => ({ ok: true, id: `run-${row.caseId}` }),
        baseline: async () => ({ html: "<main>Baseline</main>" }),
        adapt: async (row) => Number(row.caseId.slice(-2)) >= 72
          ? { ok: false, reasonCode: "provider_error", usage: paidFailureUsage, durationMs: 4 }
          : {
              ok: true, html: "<main>Candidate</main>", durationMs: 5,
              usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 1, thinkingTokens: 2 },
              structuralFingerprintBefore: "sha256:" + "a".repeat(64),
              structuralFingerprintAfter: "sha256:" + "a".repeat(64),
              promptVersion: "prompt/1", contractVersion: "creative-direction/1.0",
              policyVersion: "policy/1", taxonomyVersion: "taxonomy/1", modelVersion: "model/1",
            },
        critique: async () => ({
          visualQuality: 0, briefAdherence: 0, issues: [], shouldRegenerate: false,
          regenerationFeedback: "", fallback: true,
          usage: { inputTokens: 2, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
        }),
        render: async () => Uint8Array.from([1, 2, 3]),
        writeEvidence: async () => undefined,
        complete: async (_id, outcome) => { completions.push(outcome); },
      },
    });
    expect(result).toEqual({ started: 75, evidence: 72 });
    expect(completions).toHaveLength(75);
    expect(completions[0]).toMatchObject({
      status: "adapted", criticFallback: true, productionEquivalentCostMicromxn: 18,
      structuralInvariantPassed: true,
    });
    for (const outcome of completions.slice(72)) {
      expect(outcome).toMatchObject({
        status: "fallback", reasonCode: "provider_error",
        inputTokens: 7, outputTokens: 3,
        productionEquivalentCostMicromxn: 10,
      });
      expect(outcome.structuralInvariantPassed).toBeUndefined();
    }
    const score = scoreVisualEngine2APilot(completions.map((outcome, index) => ({
      started: true,
      technicalSuccess: outcome.status === "adapted",
      verdict: index < 65 ? "candidate" as const : index < 72 ? "tie" as const : null,
      structuralFailure: outcome.structuralInvariantPassed === false,
      partialPersistenceFailure: outcome.candidatePersisted === true,
      acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: outcome.productionEquivalentCostMicromxn,
    })), { verified: true });
    expect(score).toMatchObject({
      started: 75, technicalSuccesses: 72, technicalFailures: 3,
      technicalSuccessRate: 72 / 75, structuralFailures: 0, costRowsRecorded: 75, passed: true,
    });
  });

  it("downgrades an adapted fingerprint mismatch before evidence and fails the structural gate", async () => {
    const eligible = Array.from({ length: 75 }, (_, index) => ({
      caseId: `case-${index}`, scenarioId: "plain", datasetVersion: "visual-engine-2a-cohort/1.0" as const, archetype: "technical_saas" as const, language: "en" as const,
      brief: "fixture", forbiddenSignals: [], allowedSkeletonTemplateIds: ["template"], templateId: "template",
    }));
    const completions: Array<Parameters<Parameters<typeof generateVisualEngine2AEvidence>[0]["deps"]["complete"]>[1]> = [];
    const writeEvidence = vi.fn(async () => undefined);
    const result = await generateVisualEngine2AEvidence({
      eligible, rateCardVersion: "test/1",
      calculateCosts: () => ({ productionEquivalentCostMicromxn: 0, observedPilotCostMicromxn: 0 }),
      deps: {
        reserve: async (row) => ({ ok: true, id: row.caseId }),
        baseline: async () => ({ html: "baseline" }),
        adapt: async (row) => row.caseId === "case-1"
          ? { ok: false, reasonCode: "provider_error", durationMs: 1 }
          : {
              ok: true, html: "candidate", durationMs: 1,
              usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
              structuralFingerprintBefore: `sha256:${"a".repeat(64)}`,
              structuralFingerprintAfter: `sha256:${(row.caseId === "case-0" ? "b" : "a").repeat(64)}`,
              promptVersion: "p", contractVersion: "c", policyVersion: "policy",
              taxonomyVersion: "t", modelVersion: "m",
            },
        critique: async () => ({
          visualQuality: 8, briefAdherence: 8, issues: [], shouldRegenerate: false,
          regenerationFeedback: "", fallback: false,
        }),
        render: async () => Uint8Array.from([1]),
        writeEvidence,
        complete: async (_id, outcome) => { completions.push(outcome); },
      },
    });
    expect(result).toEqual({ started: 75, evidence: 73 });
    expect(writeEvidence).toHaveBeenCalledTimes(73);
    expect(completions).toHaveLength(75);
    expect(completions[0]).toMatchObject({
      status: "fallback", reasonCode: "structural_invariant_failed", structuralInvariantPassed: false,
    });
    expect(completions[1].structuralInvariantPassed).toBeUndefined();
    for (const outcome of completions.slice(2)) expect(outcome.structuralInvariantPassed).toBe(true);
    const score = scoreVisualEngine2APilot(completions.map((outcome, index) => ({
      started: true,
      technicalSuccess: outcome.status === "adapted",
      verdict: index >= 2 && index < 68 ? "candidate" as const : index >= 68 ? "tie" as const : null,
      structuralFailure: outcome.structuralInvariantPassed === false,
      partialPersistenceFailure: outcome.candidatePersisted === true,
      acceptedForbiddenSignals: 0,
      productionEquivalentCostMicromxn: outcome.productionEquivalentCostMicromxn,
    })), { verified: true });
    expect(score).toMatchObject({
      technicalSuccesses: 73, technicalFailures: 2, structuralFailures: 1, passed: false,
    });
    expect(score.failures).toContain("structuralIntegrity");
  });

  it("uses the Quick weighted pick for baseline evidence and the safe skeleton only for the candidate", async () => {
    const fill = vi.fn(async (templateId: string) => ({
      ok: true as const,
      normalizedHtml: `<main>${templateId}</main>`,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const builds = await prepareVisualEngine2ABuilds({
      rankedTemplateIds: ["weighted-first", "weighted-second"],
      safeTemplateId: "safe-skeleton",
      copy: { business_name: "Fixture" },
      random: () => 0,
      fill,
    });
    expect(builds.baselineTemplateId).toBe("weighted-first");
    expect(builds.candidateTemplateId).toBe("safe-skeleton");
    expect(builds.baselineBuild.normalizedHtml).toBe("<main>weighted-first</main>");
    expect(builds.candidateBuild.normalizedHtml).toBe("<main>safe-skeleton</main>");
    expect(fill.mock.calls.map(([templateId]) => templateId)).toEqual(["weighted-first", "safe-skeleton"]);

    const eligible = Array.from({ length: 75 }, (_, index) => ({
      caseId: `case-${index}`, scenarioId: "plain", datasetVersion: "visual-engine-2a-cohort/1.0" as const, archetype: "technical_saas" as const, language: "en" as const,
      brief: "fixture", forbiddenSignals: [], allowedSkeletonTemplateIds: ["safe-skeleton"], templateId: "safe-skeleton",
    }));
    let firstEvidence: Record<string, Uint8Array> | undefined;
    await generateVisualEngine2AEvidence({
      eligible, rateCardVersion: "test/1", calculateCosts: () => ({ productionEquivalentCostMicromxn: 1, observedPilotCostMicromxn: 1 }),
      deps: {
        reserve: async (row) => ({ ok: true, id: row.caseId }),
        baseline: async () => ({ html: `${builds.baselineBuild.normalizedHtml}|final` }),
        adapt: async () => ({
          ok: true, html: `${builds.candidateBuild.normalizedHtml}|adapted`, durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, thinkingTokens: 0 },
          structuralFingerprintBefore: `sha256:${"a".repeat(64)}`, structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
          promptVersion: "p", contractVersion: "c", policyVersion: "policy", taxonomyVersion: "t", modelVersion: "m",
        }),
        critique: async () => ({ visualQuality: 8, briefAdherence: 8, issues: [], shouldRegenerate: false, regenerationFeedback: "", fallback: false }),
        render: async (html) => Buffer.from(html),
        writeEvidence: async (_key, files) => { firstEvidence ??= files; },
        complete: async () => undefined,
      },
    });
    expect(Buffer.from(firstEvidence!.baselineNormal).toString()).toBe("<main>weighted-first</main>|final");
    expect(Buffer.from(firstEvidence!.candidateNormal).toString()).toBe("<main>safe-skeleton</main>|adapted");
  });
});
