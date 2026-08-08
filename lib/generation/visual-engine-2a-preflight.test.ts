import { describe, expect, it, vi } from "vitest";

import { INTENT_PROMPT_VERSION } from "./analyze-intent";
import { DECISION_POLICY_VERSION } from "./decide-route";
import type { SafeSelectionResult } from "./safe-selection";
import { TAXONOMY_COMPATIBILITY_VERSION } from "./taxonomy-compatibility";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "./visual-engine-2a-cohort";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import type { VisualEngine2AQualificationManifest } from "./visual-engine-2a-qualification";
import {
  runVisualEngine2APreflight,
  type VisualEngine2APreflightDependencies,
} from "./visual-engine-2a-preflight";

const RATE_CARD = {
  version: "gemini-test/2026-08-08",
  inputUsdPerMillion: 2,
  cachedInputUsdPerMillion: 0.5,
  outputUsdPerMillion: 8,
  thinkingUsdPerMillion: 1,
};
const COMMIT_SHA = "a".repeat(40);
const USAGE = { inputTokens: 100, cachedTokens: 25, outputTokens: 10, thinkingTokens: 5 };

function decision(route: Extract<SafeSelectionResult, { ok: true }>["decision"]["route"], templateId: string | null) {
  return {
    schemaVersion: "generation-decision/1.0" as const,
    route,
    templateId,
    structuralFit: 1,
    identityFit: 1,
    adaptationCost: 0,
    selectedSections: [],
    rejectedCandidates: [],
  };
}

function qualificationCurrent(): Omit<VisualEngine2AQualificationManifest, "manifestSha256"> {
  const templateIds = [...new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((item) => item.allowedSkeletonTemplateIds))].sort();
  return {
    schemaVersion: "visual-engine-2a-qualification/1.0",
    datasetVersion: "visual-engine-2a-cohort/1.0",
    datasetSha256: canonicalJsonSha256(VISUAL_ENGINE_2A_PILOT_CASES),
    catalogSha256: `sha256:${"b".repeat(64)}`,
    commitSha: COMMIT_SHA,
    promptVersion: INTENT_PROMPT_VERSION,
    policyVersion: DECISION_POLICY_VERSION,
    taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
    cases: VISUAL_ENGINE_2A_PILOT_CASES.map((item) => ({
      caseId: item.id,
      selectedTemplateId: item.allowedSkeletonTemplateIds[0],
      allowedTemplateIdsSha256: canonicalJsonSha256([...item.allowedSkeletonTemplateIds].sort()),
    })).sort((left, right) => left.caseId.localeCompare(right.caseId)),
    templates: templateIds.map((id) => ({
      id,
      metadataSha256: `sha256:${"c".repeat(64)}`,
      htmlSha256: `sha256:${"d".repeat(64)}`,
      inventorySha256: `sha256:${"e".repeat(64)}`,
    })),
    baseCaseCount: 15,
    expandedRowCount: 75,
  };
}

function manifest(current = qualificationCurrent()): VisualEngine2AQualificationManifest {
  return { ...current, manifestSha256: canonicalJsonSha256(current) };
}

function selected(
  row: Parameters<VisualEngine2APreflightDependencies["select"]>[0],
  overrides: Partial<Extract<SafeSelectionResult, { ok: true }>> = {},
): Extract<SafeSelectionResult, { ok: true }> {
  const cohortCase = VISUAL_ENGINE_2A_PILOT_CASES.find((item) => item.id === row.caseId)!;
  return {
    ok: true,
    intent: cohortCase.expectedIntent,
    decision: decision("template_skeleton", cohortCase.allowedSkeletonTemplateIds[0]),
    ranked: [],
    promptVersion: INTENT_PROMPT_VERSION,
    policyVersion: DECISION_POLICY_VERSION,
    modelId: "gemini-test",
    usage: USAGE,
    durationMs: 4,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<VisualEngine2APreflightDependencies> = {},
): VisualEngine2APreflightDependencies {
  const currentQualification = qualificationCurrent();
  return {
    cases: VISUAL_ENGINE_2A_PILOT_CASES,
    qualification: manifest(currentQualification),
    currentQualification,
    quota: { limit: 75, used: 0, existingRuns: 0 },
    modelId: "gemini-test",
    rateCard: RATE_CARD,
    mxnPerUsd: 20,
    select: async (row) => selected(row),
    now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(400),
    ...overrides,
  };
}

describe("Visual Engine 2A corrected live preflight", () => {
  it("awaits and validates all 75 selections before exposing any row for reservation", async () => {
    const releases: Array<{
      row: Parameters<VisualEngine2APreflightDependencies["select"]>[0];
      resolve(value: SafeSelectionResult): void;
    }> = [];
    const reserve = vi.fn();
    const pending = runVisualEngine2APreflight(dependencies({
      select: (row) => new Promise((resolve) => releases.push({ row, resolve })),
    })).then((result) => {
      if (result.ok) for (const row of result.eligible) reserve(row);
      return result;
    });
    await vi.waitFor(() => expect(releases).toHaveLength(75));
    for (let index = 0; index < 74; index += 1) {
      releases[index].resolve(selected(releases[index].row));
    }
    await Promise.resolve();
    expect(reserve).not.toHaveBeenCalled();
    releases[74].resolve(selected(releases[74].row));

    const result = await pending;
    expect(result).toMatchObject({ ok: true, report: { counts: { analyzed: 75, templateSkeleton: 75 }, reservationCount: 0 } });
    expect(reserve).toHaveBeenCalledTimes(75);
  });

  it("aggregates complete intent usage and prices it through the shared rate card", async () => {
    const result = await runVisualEngine2APreflight(dependencies());

    expect(result).toMatchObject({
      ok: true,
      report: {
        schemaVersion: "visual-engine-2a-preflight/1.0",
        datasetVersion: "visual-engine-2a-cohort/1.0",
        datasetSha256: canonicalJsonSha256(VISUAL_ENGINE_2A_PILOT_CASES),
        qualificationManifestSha256: manifest().manifestSha256,
        commitSha: COMMIT_SHA,
        modelId: "gemini-test",
        promptVersion: INTENT_PROMPT_VERSION,
        policyVersion: DECISION_POLICY_VERSION,
        taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
        rateCardVersion: RATE_CARD.version,
        tokens: { inputTokens: 7_500, cachedTokens: 1_875, outputTokens: 750, thinkingTokens: 375 },
        usageComplete: true,
        productionEquivalentCostMicromxn: 371_250,
        totalDurationMs: 300,
        reservationCount: 0,
      },
    });
    if (result.ok) {
      expect(result.eligible).toHaveLength(75);
      const { reportSha256, ...unsigned } = result.report;
      expect(reportSha256).toBe(canonicalJsonSha256(unsigned));
    }
  });

  it("marks usage incomplete and cost unknown when any paid response omits usage", async () => {
    let calls = 0;
    const result = await runVisualEngine2APreflight(dependencies({
      select: async (row) => selected(row, calls++ === 0 ? { usage: undefined } : {}),
    }));

    expect(result.report).toMatchObject({
      usageComplete: false,
      tokens: null,
      productionEquivalentCostMicromxn: null,
      reservationCount: 0,
    });
  });

  it.each([
    ["provider failure", async (row: Parameters<VisualEngine2APreflightDependencies["select"]>[0], index: number) => index === 8 ? { ok: false as const, errorKind: "api", usage: USAGE, durationMs: 4 } : selected(row)],
    ["full route", async (row: Parameters<VisualEngine2APreflightDependencies["select"]>[0], index: number) => selected(row, index === 8 ? { decision: decision("template_full", row.allowedSkeletonTemplateIds[0]) } : {})],
    ["composition route", async (row: Parameters<VisualEngine2APreflightDependencies["select"]>[0], index: number) => selected(row, index === 8 ? { decision: decision("section_composition", null) } : {})],
    ["outside allowlist", async (row: Parameters<VisualEngine2APreflightDependencies["select"]>[0], index: number) => selected(row, index === 8 ? { decision: decision("template_skeleton", "outside") } : {})],
  ])("fails all-or-nothing for one %s after completing every selection", async (_label, response) => {
    let calls = 0;
    const result = await runVisualEngine2APreflight(dependencies({
      select: async (row) => response(row, calls++),
    }));

    expect(calls).toBe(75);
    expect(result).toMatchObject({ ok: false, report: { counts: { analyzed: 75 }, reservationCount: 0 } });
  });

  it.each([
    ["stale manifest", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, qualification: { ...deps.qualification, manifestSha256: `sha256:${"0".repeat(64)}` } })],
    ["dataset version mismatch", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, currentQualification: { ...deps.currentQualification, datasetVersion: "wrong" as never } })],
    ["source hash mismatch", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, currentQualification: { ...deps.currentQualification, datasetSha256: `sha256:${"1".repeat(64)}` } })],
    ["catalog hash mismatch", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, currentQualification: { ...deps.currentQualification, catalogSha256: `sha256:${"2".repeat(64)}` } })],
    ["quota mismatch", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, quota: { limit: 74, used: 0, existingRuns: 0 } })],
    ["used quota", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, quota: { limit: 75, used: 1, existingRuns: 0 } })],
    ["existing runs", (deps: VisualEngine2APreflightDependencies) => ({ ...deps, quota: { limit: 75, used: 0, existingRuns: 1 } })],
  ])("rejects %s before any provider call", async (_label, mutate) => {
    const select = vi.fn();
    const result = await runVisualEngine2APreflight(mutate(dependencies({ select })));

    expect(result).toMatchObject({ ok: false, report: { counts: { analyzed: 0 }, reservationCount: 0 } });
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    ["fewer than ten distinct selected templates", (current: Omit<VisualEngine2AQualificationManifest, "manifestSha256">) => ({
      ...current,
      cases: current.cases.map((item, index) => ({ ...item, selectedTemplateId: `shared-${index % 9}` })),
    })],
    ["one template selected by three base cases", (current: Omit<VisualEngine2AQualificationManifest, "manifestSha256">) => ({
      ...current,
      cases: current.cases.map((item, index) => ({ ...item, selectedTemplateId: index < 3 ? "tripled" : item.selectedTemplateId })),
    })],
  ])("rejects an internally invalid qualification with %s", async (_label, mutate) => {
    const currentQualification = mutate(qualificationCurrent());
    const select = vi.fn();
    const result = await runVisualEngine2APreflight(dependencies({
      currentQualification,
      qualification: manifest(currentQualification),
      select,
    }));

    expect(result).toMatchObject({ ok: false, report: { reservationCount: 0 } });
    expect(select).not.toHaveBeenCalled();
  });

  it("emits only one aggregate redacted record shape", async () => {
    const result = await runVisualEngine2APreflight(dependencies());
    const serialized = JSON.stringify(result.report);

    for (const forbidden of [
      VISUAL_ENGINE_2A_PILOT_CASES[0].brief,
      JSON.stringify(VISUAL_ENGINE_2A_PILOT_CASES[0].expectedIntent),
      "<html", "raw provider response", "api-key-secret", "C:\\private\\path", "reviewer@example.test",
    ]) expect(serialized).not.toContain(forbidden);
    expect(Object.keys(result.report).sort()).toEqual([
      "commitSha", "counts", "datasetSha256", "datasetVersion", "modelId", "policyVersion",
      "productionEquivalentCostMicromxn", "promptVersion", "qualificationManifestSha256", "rateCardVersion",
      "reportSha256", "reservationCount", "schemaVersion", "taxonomyVersion", "tokens", "totalDurationMs",
      "usageComplete",
    ].sort());
  });
});
