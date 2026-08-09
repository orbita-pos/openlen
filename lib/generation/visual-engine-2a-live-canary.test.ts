import { describe, expect, it, vi } from "vitest";

import { INTENT_PROMPT_VERSION } from "./analyze-intent";
import { DECISION_POLICY_VERSION } from "./decide-route";
import type { SafeSelectionResult } from "./safe-selection";
import { TAXONOMY_COMPATIBILITY_VERSION } from "./taxonomy-compatibility";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "./visual-engine-2a-cohort";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import {
  runVisualEngine2ALiveCanary,
  type VisualEngine2ALiveCanaryDependencies,
} from "./visual-engine-2a-live-canary";
import type { VisualEngine2AQualificationManifest } from "./visual-engine-2a-qualification";

const RATE_CARD = {
  version: "gemini-test/2026-08-08",
  inputUsdPerMillion: 2,
  cachedInputUsdPerMillion: 0.5,
  outputUsdPerMillion: 8,
  thinkingUsdPerMillion: 1,
};
const COMMIT_SHA = "a".repeat(40);
const USAGE = { inputTokens: 100, cachedTokens: 25, outputTokens: 10, thinkingTokens: 5 };

function decision(
  route: Extract<SafeSelectionResult, { ok: true }>["decision"]["route"],
  templateId: string | null,
) {
  return {
    schemaVersion: "generation-decision/1.0" as const,
    route,
    templateId,
    structuralFit: 0.95,
    identityFit: 0.9,
    adaptationCost: 0.1,
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
  row: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0],
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
  overrides: Partial<VisualEngine2ALiveCanaryDependencies> = {},
): VisualEngine2ALiveCanaryDependencies {
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

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key.toLowerCase());
      collectKeys(item, keys);
    }
  }
  return keys;
}

describe("Visual Engine 2A strict live canary", () => {
  it("selects each plain base case once with exactly three requests maximum in flight", async () => {
    const calls: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0][] = [];
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const pending = runVisualEngine2ALiveCanary(dependencies({
      select: async (row) => {
        calls.push(row);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => releases.push(resolve));
        inFlight -= 1;
        return selected(row);
      },
    }));

    for (let completed = 0; completed < 15; completed += 1) {
      await vi.waitFor(() => expect(calls.length).toBe(Math.min(completed + 3, 15)));
      releases[completed]();
    }

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(15);
    expect(new Set(calls.map((row) => row.caseId)).size).toBe(15);
    expect(calls.every((row) => row.scenarioId === "plain")).toBe(true);
    expect(maxInFlight).toBe(3);
  });

  it.each([
    ["returned failure", async () => ({ ok: false as const, errorKind: "timeout", durationMs: 4 })],
    ["thrown failure", async () => { throw new Error("provider body must not escape"); }],
  ])("does not retry or replace a case after a %s", async (_label, firstResponse) => {
    const calls = new Map<string, number>();
    const result = await runVisualEngine2ALiveCanary(dependencies({
      select: async (row) => {
        calls.set(row.caseId, (calls.get(row.caseId) ?? 0) + 1);
        return calls.size === 1 ? firstResponse() : selected(row);
      },
    }));

    expect(result).toMatchObject({ ok: false, code: "selection_failed" });
    expect([...calls.values()]).toEqual(Array.from({ length: 15 }, () => 1));
  });

  it("expands one successful exact-template selection per case to 75 rows with complete redacted evidence", async () => {
    const result = await runVisualEngine2ALiveCanary(dependencies());

    expect(result).toMatchObject({
      ok: true,
      report: {
        schemaVersion: "visual-engine-2a-live-canary/1.0",
        datasetVersion: "visual-engine-2a-cohort/1.0",
        datasetSha256: canonicalJsonSha256(VISUAL_ENGINE_2A_PILOT_CASES),
        qualificationManifestSha256: manifest().manifestSha256,
        catalogSha256: qualificationCurrent().catalogSha256,
        commitSha: COMMIT_SHA,
        modelId: "gemini-test",
        promptVersion: INTENT_PROMPT_VERSION,
        policyVersion: DECISION_POLICY_VERSION,
        taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
        rateCardVersion: RATE_CARD.version,
        counts: { cases: 15, analyzed: 15, passed: 15, failed: 0 },
        tokens: { inputTokens: 1_500, cachedTokens: 375, outputTokens: 150, thinkingTokens: 75 },
        usageComplete: true,
        productionEquivalentCostMicromxn: 74_250,
        totalDurationMs: 300,
        reservationCount: 0,
      },
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.eligible).toHaveLength(75);
    expect(result.selectionsByCase.size).toBe(15);
    for (const [caseId, selection] of result.selectionsByCase) {
      expect(result.eligible.filter((row) => row.caseId === caseId)).toHaveLength(5);
      expect(selection.intent).toBe(VISUAL_ENGINE_2A_PILOT_CASES.find((item) => item.id === caseId)!.expectedIntent);
    }
    expect(result.report.rows).toHaveLength(15);
    expect(result.report.rows.map((row) => row.caseId)).toEqual(
      [...VISUAL_ENGINE_2A_PILOT_CASES].map((item) => item.id).sort(),
    );
    expect(result.report.rows.every((row) => row.intentSha256?.startsWith("sha256:"))).toBe(true);
    expect(result.report.rows.every((row) => Object.keys(row).sort().join(",") === [
      "adaptationCost", "caseId", "identityFit", "intentSha256", "resultCode", "route",
      "selectedTemplateId", "structuralFit", "usage",
    ].sort().join(","))).toBe(true);
    const { reportSha256, ...unsigned } = result.report;
    expect(reportSha256).toBe(canonicalJsonSha256(unsigned));

    const serialized = JSON.stringify(result.report);
    for (const cohortCase of VISUAL_ENGINE_2A_PILOT_CASES) {
      expect(serialized).not.toContain(cohortCase.brief);
      expect(serialized).not.toContain(JSON.stringify(cohortCase.expectedIntent));
    }
    const keys = collectKeys(result.report);
    for (const forbidden of ["intent", "ranked", "prompt", "response", "html", "copy", "email", "path", "message"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it.each([
    ["invalid quota", "invalid_quota", (deps: VisualEngine2ALiveCanaryDependencies) => ({ ...deps, quota: { limit: 74, used: 0, existingRuns: 0 } })],
    ["used quota", "invalid_quota", (deps: VisualEngine2ALiveCanaryDependencies) => ({ ...deps, quota: { limit: 75, used: 1, existingRuns: 0 } })],
    ["existing rows", "existing_runs", (deps: VisualEngine2ALiveCanaryDependencies) => ({ ...deps, quota: { limit: 75, used: 0, existingRuns: 1 } })],
    ["invalid qualification", "qualification_invalid", (deps: VisualEngine2ALiveCanaryDependencies) => ({ ...deps, currentQualification: { ...deps.currentQualification, datasetSha256: `sha256:${"1".repeat(64)}` } })],
    ["stale qualification", "qualification_stale", (deps: VisualEngine2ALiveCanaryDependencies) => ({ ...deps, qualification: { ...deps.qualification, manifestSha256: `sha256:${"0".repeat(64)}` } })],
  ])("rejects %s before a provider call", async (_label, code, mutate) => {
    const select = vi.fn();
    const result = await runVisualEngine2ALiveCanary(mutate(dependencies({ select })));

    expect(result).toMatchObject({
      ok: false,
      code,
      report: { counts: { cases: 15, analyzed: 0, passed: 0, failed: 15 }, reservationCount: 0 },
    });
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    ["missing_key", "selection_failed", () => ({ ok: false as const, errorKind: "missing_key", durationMs: 4 })],
    ["api", "selection_failed", () => ({ ok: false as const, errorKind: "api", durationMs: 4 })],
    ["parse", "selection_failed", () => ({ ok: false as const, errorKind: "parse", durationMs: 4 })],
    ["schema", "selection_failed", () => ({ ok: false as const, errorKind: "schema", durationMs: 4 })],
    ["timeout", "selection_failed", () => ({ ok: false as const, errorKind: "timeout", durationMs: 4 })],
    ["unknown provider error", "selection_failed", () => ({ ok: false as const, errorKind: "provider secret text", durationMs: 4 })],
    ["version mismatch", "version_mismatch", (row: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0]) => selected(row, { modelId: "wrong" })],
    ["missing usage", "usage_missing", (row: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0]) => selected(row, { usage: undefined })],
    ["non-skeleton route", "ineligible_route", (row: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0]) => selected(row, { decision: decision("section_composition", null) })],
    ["outside allowlist", "template_outside_allowlist", (row: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0]) => selected(row, { decision: decision("template_skeleton", "outside") })],
    ["different qualified template", "template_outside_allowlist", (row: Parameters<VisualEngine2ALiveCanaryDependencies["select"]>[0]) => selected(row, { decision: decision("template_skeleton", row.allowedSkeletonTemplateIds[1] ?? "outside") })],
  ])("maps %s to a redacted terminal row and strict failure", async (_label, code, response) => {
    let calls = 0;
    const result = await runVisualEngine2ALiveCanary(dependencies({
      select: async (row) => calls++ === 0 ? response(row) : selected(row),
    }));

    expect(calls).toBe(15);
    expect(result).toMatchObject({
      ok: false,
      code,
      report: { counts: { cases: 15, analyzed: 15, passed: 14, failed: 1 }, reservationCount: 0 },
    });
    expect(result.report.rows).toHaveLength(15);
    expect(JSON.stringify(result.report)).not.toContain("provider secret text");
    if (_label === "missing usage") {
      expect(result.report).toMatchObject({ usageComplete: false, tokens: null, productionEquivalentCostMicromxn: null });
    }
  });

  it("chooses terminal failure precedence by frozen case order rather than completion order", async () => {
    const sortedIds = [...VISUAL_ENGINE_2A_PILOT_CASES].map((item) => item.id).sort();
    const result = await runVisualEngine2ALiveCanary(dependencies({
      select: async (row) => {
        if (row.caseId === sortedIds[0]) {
          await Promise.resolve();
          return selected(row, { decision: decision("section_composition", null) });
        }
        if (row.caseId === sortedIds[1]) return { ok: false, errorKind: "api", durationMs: 1 };
        return selected(row);
      },
    }));

    expect(result).toMatchObject({ ok: false, code: "ineligible_route" });
    expect(result.report.rows.slice(0, 2).map((row) => row.resultCode)).toEqual(["ineligible_route", "api"]);
  });
});
