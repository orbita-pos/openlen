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
  prepareVisualEngine2ABuilds,
  captureVisualEngine2ARollbackModes,
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
      caseId: `case-${index}`, scenarioId: "plain", language: "en" as const,
      brief: "fixture", forbiddenSignals: [], templateId: "safe-skeleton",
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
