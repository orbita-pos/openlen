import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { INTENT_PROMPT_VERSION } from "./analyze-intent";
import type { SafeSelectionResult } from "./safe-selection";
import { DECISION_POLICY_VERSION } from "./decide-route";
import { TAXONOMY_COMPATIBILITY_VERSION } from "./taxonomy-compatibility";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "./visual-engine-2a-cohort";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { rankTemplates } from "./score-template";
import type { VisualEngine2AQualificationManifest } from "./visual-engine-2a-qualification";
import type { VisualEngine2AEvalCliDependencies } from "@/scripts/visual-engine-2a-eval";

const COMMIT_SHA = "a".repeat(40);
const USAGE = { inputTokens: 8, cachedTokens: 2, outputTokens: 3, thinkingTokens: 1 };

function qualificationCurrent(): Omit<VisualEngine2AQualificationManifest, "manifestSha256"> {
  const ids = [...new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((item) => item.allowedSkeletonTemplateIds))].sort();
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
    templates: ids.map((id) => ({
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

function selection(row: Parameters<VisualEngine2AEvalCliDependencies["select"]>[0], route: "template_skeleton" | "template_full" = "template_skeleton", templateId = row.allowedSkeletonTemplateIds[0]): SafeSelectionResult {
  const source = VISUAL_ENGINE_2A_PILOT_CASES.find((item) => item.id === row.caseId)!;
  return {
    ok: true,
    intent: source.expectedIntent,
    decision: {
      schemaVersion: "generation-decision/1.0",
      route,
      templateId,
      structuralFit: 1,
      identityFit: 1,
      adaptationCost: 0,
      selectedSections: [],
      rejectedCandidates: [],
    },
    ranked: [],
    promptVersion: INTENT_PROMPT_VERSION,
    policyVersion: DECISION_POLICY_VERSION,
    modelId: "gemini-test",
    usage: USAGE,
    durationMs: 2,
  };
}

function fixture(overrides: Partial<VisualEngine2AEvalCliDependencies> = {}) {
  const current = qualificationCurrent();
  const writes: Array<{ path: string; value: unknown }> = [];
  const logs: string[] = [];
  const order: string[] = [];
  const reservations: string[] = [];
  const deps: VisualEngine2AEvalCliDependencies = {
    mode: "shadow",
    modelId: "gemini-test",
    rateCard: {
      version: "rate-card/1",
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.5,
      outputUsdPerMillion: 8,
      thinkingUsdPerMillion: 1,
      mxnPerUsd: 20,
    },
    getQuota: vi.fn(async () => { order.push("quota"); return { limit: 75, used: 0, existingRuns: 0 }; }),
    getCommitSha: vi.fn(async () => { order.push("head"); return COMMIT_SHA; }),
    readQualification: vi.fn(async () => { order.push("qualification"); return manifest(current); }),
    recomputeQualification: vi.fn(async () => { order.push("recompute"); return manifest(current); }),
    select: vi.fn(async (row) => { order.push("provider"); return selection(row); }),
    writeJsonAtomic: vi.fn(async (path, value) => { order.push("write"); writes.push({ path, value }); }),
    generateEvidence: vi.fn(async (eligible) => {
      order.push("evidence");
      for (const row of eligible) {
        order.push("reserve");
        reservations.push(`${row.caseId}/${row.scenarioId}/${row.templateId}`);
      }
      return { started: eligible.length, evidence: eligible.length };
    }),
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, writes, logs, order, reservations };
}

async function run(deps: VisualEngine2AEvalCliDependencies, cwd = join("workspace", "openlen")) {
  const { runVisualEngine2AEvalCli } = await import("@/scripts/visual-engine-2a-eval");
  return runVisualEngine2AEvalCli(deps, cwd);
}

describe("Visual Engine 2A eval CLI injected integration", () => {
  it("loads only published templates at the production catalog boundary", async () => {
    const source = VISUAL_ENGINE_2A_PILOT_CASES[0];
    const metadata = {
      schemaVersion: "template-visual-metadata/1.0" as const,
      domains: [...source.expectedIntent.domains],
      audiences: [source.expectedIntent.audience.primary],
      ageRanges: [], emotionalRegisters: [], visualArchetypes: [], visualSignals: [],
      layoutTraits: [], requiredAssetTypes: [], negativeTags: [],
      supportedSiteTypes: [source.expectedIntent.functional.siteType],
      supportedSectionRoles: [...source.expectedIntent.functional.requiredSections],
      themeability: "high" as const,
      identityStrength: "high" as const,
      reviewStatus: "reviewed" as const,
    };
    const mixed = [
      { id: "draft-winner", status: "draft", visualMetadata: metadata },
      { id: "published-only", status: "published", visualMetadata: metadata },
      { id: "archived-winner", status: "archived", visualMetadata: metadata },
    ] as const;
    const listTemplates = vi.fn(async () => mixed);
    const { loadVisualEngine2APublishedCatalog } = await import("@/scripts/visual-engine-2a-eval");

    const catalog = await loadVisualEngine2APublishedCatalog(listTemplates);

    expect(listTemplates).toHaveBeenCalledWith({ status: "published" });
    expect(catalog.map((row) => row.id)).toEqual(["published-only"]);
    expect(canonicalJsonSha256(catalog)).toBe(canonicalJsonSha256([mixed[1]]));
    expect(canonicalJsonSha256(catalog)).not.toBe(canonicalJsonSha256(mixed));
    expect(rankTemplates(source.expectedIntent, catalog).map((row) => row.id)).toEqual(["published-only"]);
  });

  it("documents redacted artifacts, preflight barriers, and the no-replacement cohort policy", async () => {
    const cohortOps = await readFile(resolve(process.cwd(), "docs/generation/visual-engine-2a-pilot-cohort.md"), "utf8");

    for (const contract of [
      "scratch/visual-engine-2a/qualification.json",
      "scratch/visual-engine-2a/preflight.json",
      "reservationCount=0",
      "75/75",
      "redacted aggregate schemas",
      "usage-incomplete",
      "no replacement rows",
      "abandoned",
      "72–75",
      "unchanged score gates",
      "npx.cmd tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2a-rollback-check.ts",
      "must not run without new explicit approval",
    ]) expect(cohortOps).toContain(contract);
  });

  it("imports without eager database, template-store, provider, or console side effects", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    vi.stubEnv("OPENLEN_VISUAL_ENGINE", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const module = await import("@/scripts/visual-engine-2a-eval");

    expect(module.runVisualEngine2AEvalCli).toBeTypeOf("function");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("verifies the qualification HEAD snapshot and recomputed hashes before provider selection", async () => {
    const state = fixture();

    const result = await run(state.deps);

    expect(result.ok).toBe(true);
    expect(state.order.indexOf("head")).toBeLessThan(state.order.indexOf("provider"));
    expect(state.order.indexOf("qualification")).toBeLessThan(state.order.indexOf("provider"));
    expect(state.order.indexOf("recompute")).toBeLessThan(state.order.indexOf("provider"));
  });

  it("rejects a stale qualification artifact with zero provider or reservation calls", async () => {
    const state = fixture({
      readQualification: async () => ({ ...manifest(), manifestSha256: `sha256:${"0".repeat(64)}` }),
    });

    const result = await run(state.deps);

    expect(result.ok).toBe(false);
    expect(state.deps.select).not.toHaveBeenCalled();
    expect(state.reservations).toHaveLength(0);
    expect(state.logs).toHaveLength(1);
  });

  it("rechecks HEAD after recomputing hashes and refuses a changed checkout before provider", async () => {
    const commits = [COMMIT_SHA, "f".repeat(40)];
    const state = fixture({ getCommitSha: vi.fn(async () => commits.shift()!) });

    const result = await run(state.deps);

    expect(result.ok).toBe(false);
    expect(state.deps.getCommitSha).toHaveBeenCalledTimes(2);
    expect(state.deps.select).not.toHaveBeenCalled();
    expect(state.reservations).toHaveLength(0);
  });

  it.each([
    ["74 of 75 skeletons", (row: Parameters<VisualEngine2AEvalCliDependencies["select"]>[0], index: number) => selection(row, index === 74 ? "template_full" : "template_skeleton")],
    ["one outside-allowlist template", (row: Parameters<VisualEngine2AEvalCliDependencies["select"]>[0], index: number) => selection(row, "template_skeleton", index === 74 ? "outside" : row.allowedSkeletonTemplateIds[0])],
  ])("keeps reservations at zero for %s", async (_label, selectResult) => {
    let index = 0;
    const state = fixture({ select: vi.fn(async (row) => selectResult(row, index++)) });

    const result = await run(state.deps);

    expect(result.ok).toBe(false);
    expect(index).toBe(75);
    expect(state.reservations).toHaveLength(0);
    expect(state.deps.generateEvidence).not.toHaveBeenCalled();
  });

  it("checks exact 75/0 quota and zero existing runs before provider selection", async () => {
    const state = fixture({ getQuota: async () => ({ limit: 75, used: 1, existingRuns: 0 }) });

    const result = await run(state.deps);

    expect(result.ok).toBe(false);
    expect(state.deps.select).not.toHaveBeenCalled();
    expect(state.reservations).toHaveLength(0);
  });

  it("uses a second post-qualification quota snapshot and refuses stale quota before selection", async () => {
    const state = fixture();
    const snapshots = [
      { limit: 75, used: 0, existingRuns: 0 },
      { limit: 75, used: 1, existingRuns: 0 },
    ];
    state.deps.getQuota = vi.fn(async () => {
      state.order.push("quota");
      return snapshots.shift()!;
    });

    const result = await run(state.deps);

    expect(result).toEqual({ ok: false, code: "invalid_quota" });
    expect(state.deps.getQuota).toHaveBeenCalledTimes(2);
    expect(state.order.slice(state.order.lastIndexOf("recompute"))).toEqual([
      "recompute", "head", "quota",
    ]);
    expect(state.deps.select).not.toHaveBeenCalled();
    expect(state.writes).toHaveLength(0);
    expect(state.deps.writeJsonAtomic).not.toHaveBeenCalled();
    expect(state.deps.generateEvidence).not.toHaveBeenCalled();
    expect(state.reservations).toHaveLength(0);
    expect(state.logs).toHaveLength(1);
    expect(JSON.parse(state.logs[0])).toEqual({
      event: "visual_engine_2a_eval",
      ok: false,
      code: "invalid_quota",
    });
    expect(state.logs[0]).not.toContain("qualification");
    expect(state.logs[0]).not.toContain("workspace");
  });

  it("atomically writes preflight evidence before exactly 75 existing-engine reservations", async () => {
    const cwd = join("workspace", "openlen");
    const state = fixture();

    const result = await run(state.deps, cwd);

    expect(result).toMatchObject({ ok: true, summary: { started: 75, evidence: 75 } });
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].path).toBe(join(cwd, "scratch", "visual-engine-2a", "preflight.json"));
    expect(state.writes[0].value).toMatchObject({ reservationCount: 0, counts: { templateSkeleton: 75 } });
    expect(state.order.indexOf("write")).toBeLessThan(state.order.indexOf("reserve"));
    expect(state.order.slice(state.order.indexOf("write"), state.order.indexOf("evidence") + 1)).toEqual([
      "write", "head", "recompute", "head", "quota", "evidence",
    ]);
    expect(state.reservations).toHaveLength(75);
    expect(state.deps.generateEvidence).toHaveBeenCalledTimes(1);
  });

  it("refuses a HEAD change after the 75th selection and keeps adaptation at zero", async () => {
    const state = fixture();
    const commits = [COMMIT_SHA, COMMIT_SHA, "f".repeat(40)];
    state.deps.getCommitSha = vi.fn(async () => { state.order.push("head"); return commits.shift()!; });

    const result = await run(state.deps);

    expect(result).toMatchObject({ ok: false, code: "qualification_stale", reportSha256: expect.any(String) });
    expect(state.deps.select).toHaveBeenCalledTimes(75);
    expect(state.writes).toHaveLength(1);
    expect(state.order.slice(state.order.indexOf("write"))).toEqual(["write", "head"]);
    expect(state.deps.generateEvidence).not.toHaveBeenCalled();
    expect(state.reservations).toHaveLength(0);
    expect(state.logs).toHaveLength(1);
    expect(state.logs[0]).not.toContain("workspace");
  });

  it.each(["catalog", "material"] as const)(
    "refuses %s drift after preflight and before adaptation",
    async (kind) => {
      const state = fixture();
      let recomputations = 0;
      state.deps.recomputeQualification = vi.fn(async () => {
        state.order.push("recompute");
        recomputations += 1;
        if (recomputations === 1) return manifest();
        const changed = qualificationCurrent();
        if (kind === "catalog") changed.catalogSha256 = `sha256:${"9".repeat(64)}`;
        else changed.templates[0].htmlSha256 = `sha256:${"9".repeat(64)}`;
        return manifest(changed);
      });

      const result = await run(state.deps);

      expect(result).toMatchObject({ ok: false, code: "qualification_stale", reportSha256: expect.any(String) });
      expect(state.deps.select).toHaveBeenCalledTimes(75);
      expect(state.writes).toHaveLength(1);
      expect(state.order.slice(state.order.indexOf("write"))).toEqual(["write", "head", "recompute", "head"]);
      expect(state.deps.generateEvidence).not.toHaveBeenCalled();
      expect(state.reservations).toHaveLength(0);
      expect(state.logs).toHaveLength(1);
    },
  );

  it("refuses quota drift after preflight immediately before adaptation", async () => {
    const state = fixture();
    const quotas = [
      { limit: 75, used: 0, existingRuns: 0 },
      { limit: 75, used: 0, existingRuns: 0 },
      { limit: 75, used: 1, existingRuns: 0 },
    ];
    state.deps.getQuota = vi.fn(async () => { state.order.push("quota"); return quotas.shift()!; });

    const result = await run(state.deps);

    expect(result).toMatchObject({ ok: false, code: "invalid_quota", reportSha256: expect.any(String) });
    expect(state.deps.select).toHaveBeenCalledTimes(75);
    expect(state.writes).toHaveLength(1);
    expect(state.order.slice(state.order.indexOf("write"))).toEqual([
      "write", "head", "recompute", "head", "quota",
    ]);
    expect(state.deps.generateEvidence).not.toHaveBeenCalled();
    expect(state.reservations).toHaveLength(0);
    expect(state.logs).toHaveLength(1);
    expect(JSON.parse(state.logs[0])).toMatchObject({ ok: false, code: "invalid_quota" });
    expect(state.logs[0]).not.toContain("workspace");
  });

  it("passes only frozen cohort rows to adaptation and emits one redacted terminal record", async () => {
    const state = fixture();
    const allowedRows = new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((item) => [
      "accessible-generous-spacing", "anti-generic", "identity-before-copy", "plain", "saved-brand-accent",
    ].map((scenario) => `${item.id}/${scenario}/${item.allowedSkeletonTemplateIds[0]}`)));

    await run(state.deps);

    expect(state.reservations.every((key) => allowedRows.has(key))).toBe(true);
    expect(state.logs).toHaveLength(1);
    const record = JSON.parse(state.logs[0]);
    expect(record).toMatchObject({ event: "visual_engine_2a_eval", ok: true, started: 75, evidence: 75 });
    expect(state.logs[0]).not.toContain(VISUAL_ENGINE_2A_PILOT_CASES[0].brief);
    expect(state.logs[0]).not.toContain("workspace");
  });
});
