import { describe, expect, it, vi } from "vitest";

import {
  CREATIVE_SANDBOX_CANARY_AUTHORIZATION,
  parseCreativeSandboxCanaryArgs,
  runCreativeSandboxCanary,
  type CreativeSandboxCanaryDeps,
} from "@/scripts/creative-sandbox-canary";

const COMMIT = "a".repeat(40);

function deps(over: Partial<CreativeSandboxCanaryDeps> = {}): CreativeSandboxCanaryDeps {
  return {
    authorization: CREATIVE_SANDBOX_CANARY_AUTHORIZATION,
    creationMode: "enabled",
    headCommit: COMMIT,
    fireworksKeyPresent: true,
    probeEvidence: async () => ({ "deepseek-tool": true, "qwen-vision": true }),
    runProbe: async (provider) => ({
      ok: true, resultCode: "probe_ok", modelId: `model-${provider}`,
      costMicromxn: 10, durationMs: 5, attempts: 1, providerCategory: null,
    }),
    runPage: async () => ({
      ok: true, resultCode: "delivered", modelId: "model-deepseek", costMicromxn: 100, durationMs: 50,
      attempts: 1, providerCategory: null, mutations: 3, images: 1,
      finalHash: `sha256:${"b".repeat(64)}`,
      deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false },
    }),
    writeEvidence: vi.fn(async () => undefined),
    ...over,
  };
}

const PROBE = { live: true as const, mode: { kind: "provider" as const, provider: "deepseek-tool" as const }, maxMicromxn: 1_000_000, commit: COMMIT };
const PAGE = { live: true as const, mode: { kind: "page" as const, caseId: "kids-coloring" }, maxMicromxn: 1_000_000, commit: COMMIT };

describe("creative sandbox canary argument boundary", () => {
  it.each([
    [[]],
    [["--provider=deepseek-tool", "--max-mxn=1", `--commit=${COMMIT}`]],
    [["--live", "--max-mxn=1", `--commit=${COMMIT}`]],
    [["--live", "--provider=deepseek-tool", `--commit=${COMMIT}`]],
    [["--live", "--provider=deepseek-tool", "--max-mxn=1"]],
    [["--live", "--provider=deepseek-tool", "--max-mxn=0", `--commit=${COMMIT}`]],
    [["--live", "--provider=deepseek-tool", "--max-mxn=-4", `--commit=${COMMIT}`]],
    [["--live", "--provider=deepseek-tool", "--max-mxn=1.5", `--commit=${COMMIT}`]],
    [["--live", "--provider=unknown-model", "--max-mxn=1", `--commit=${COMMIT}`]],
    [["--live", "--page=not-a-cohort-case", "--max-mxn=1", `--commit=${COMMIT}`]],
    [["--live", "--provider=deepseek-tool", "--page=kids-coloring", "--max-mxn=1", `--commit=${COMMIT}`]],
    [["--live", "--provider=deepseek-tool", "--max-mxn=1", "--commit=short"]],
  ])("refuses argv %j", (argv) => {
    expect(() => parseCreativeSandboxCanaryArgs(argv)).toThrow();
  });

  it("accepts one fully specified provider probe", () => {
    expect(parseCreativeSandboxCanaryArgs(["--live", "--provider=qwen-vision", "--max-mxn=250000", `--commit=${COMMIT}`]))
      .toEqual({ live: true, mode: { kind: "provider", provider: "qwen-vision" }, maxMicromxn: 250_000, commit: COMMIT });
  });

  it("accepts one fully specified page run", () => {
    expect(parseCreativeSandboxCanaryArgs(["--live", "--page=kids-coloring", "--max-mxn=250000", `--commit=${COMMIT}`]))
      .toEqual({ live: true, mode: { kind: "page", caseId: "kids-coloring" }, maxMicromxn: 250_000, commit: COMMIT });
  });
});

describe("creative sandbox canary gates", () => {
  it.each([
    ["unauthorized", { authorization: "guessed" }],
    ["creation_disabled", { creationMode: "disabled" }],
    ["missing_key", { fireworksKeyPresent: false }],
    ["commit_mismatch", { headCommit: "b".repeat(40) }],
  ])("fails closed with %s before any provider call", async (code, over) => {
    const runProbe = vi.fn();
    const result = await runCreativeSandboxCanary(PROBE, deps({ ...over, runProbe } as never));
    expect(result).toMatchObject({ ok: false, code });
    expect(runProbe).not.toHaveBeenCalled();
  });

  it("refuses a page run until both isolated probes have passed", async () => {
    const runPage = vi.fn();
    const result = await runCreativeSandboxCanary(PAGE, deps({
      probeEvidence: async () => ({ "deepseek-tool": true, "qwen-vision": false }),
      runPage,
    } as never));
    expect(result).toMatchObject({ ok: false, code: "probes_missing" });
    expect(runPage).not.toHaveBeenCalled();
  });

  it("refuses to start a run whose worst case exceeds the authorized cap", async () => {
    const runProbe = vi.fn();
    const result = await runCreativeSandboxCanary({ ...PROBE, maxMicromxn: 1 }, deps({ runProbe } as never));
    expect(result).toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(runProbe).not.toHaveBeenCalled();
  });

  it("never retries a failing provider probe", async () => {
    const runProbe = vi.fn(async () => { throw new Error("fireworks unreachable"); });
    const result = await runCreativeSandboxCanary(PROBE, deps({ runProbe } as never));
    expect(result).toMatchObject({ ok: false, code: "probe_failed" });
    expect(runProbe).toHaveBeenCalledTimes(1);
  });

  it("never retries a failing page", async () => {
    const runPage = vi.fn(async () => { throw new Error("boom"); });
    const result = await runCreativeSandboxCanary(PAGE, deps({ runPage } as never));
    expect(result).toMatchObject({ ok: false, code: "page_failed" });
    expect(runPage).toHaveBeenCalledTimes(1);
  });

  it("reports a cost over the cap as a failure instead of a pass", async () => {
    const result = await runCreativeSandboxCanary(PROBE, deps({
      runProbe: async () => ({ ok: true, resultCode: "probe_ok", modelId: "m", costMicromxn: 999_999_999, durationMs: 1, attempts: 1, providerCategory: null }),
    } as never));
    expect(result).toMatchObject({ ok: false, code: "budget_exceeded" });
  });
});

describe("creative sandbox canary evidence", () => {
  it("produces a signed, redacted report for a passing page", async () => {
    const writeEvidence = vi.fn(async () => undefined);
    const result = await runCreativeSandboxCanary(PAGE, deps({ writeEvidence }));

    expect(result.ok).toBe(true);
    expect(result.report).toMatchObject({
      schemaVersion: "creative-sandbox-canary/1.0",
      commit: COMMIT,
      mode: "page:kids-coloring",
      totalCostMicromxn: 100,
    });
    expect(result.report.rows[0]).toMatchObject({ ok: true, resultCode: "delivered", mutations: 3, images: 1 });
    expect(result.report.reportSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(writeEvidence).toHaveBeenCalledWith(result.report);
  });

  it("carries no prompt, page bytes, screenshot, url, credential or identity", async () => {
    const result = await runCreativeSandboxCanary(PAGE, deps());
    const serialized = JSON.stringify(result.report);

    expect(serialized).not.toMatch(/"(?:userId|email|prompt|copy|brief|html|css|screenshot|url|providerBody|credential|secret|apiKey)"\s*:/i);
    expect(serialized).not.toContain("<!doctype");
    expect(serialized).not.toContain("https://");
  });

  it("still writes evidence for a failed run", async () => {
    const writeEvidence = vi.fn(async () => undefined);
    const result = await runCreativeSandboxCanary(PAGE, deps({
      writeEvidence,
      runPage: async () => ({
        ok: false, resultCode: "semantic_gate_failed", modelId: "m", costMicromxn: 20, durationMs: 3,
        attempts: 1, providerCategory: "schema", mutations: 0, images: 0, finalHash: null,
        deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false },
      }),
    } as never));

    expect(result).toMatchObject({ ok: false, code: "page_failed" });
    expect(writeEvidence).toHaveBeenCalledTimes(1);
    expect(result.report.rows[0]).toMatchObject({ ok: false, resultCode: "semantic_gate_failed" });
  });
});
