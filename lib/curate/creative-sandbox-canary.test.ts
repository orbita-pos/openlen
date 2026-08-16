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
    pageBudgetCapMicromxn: 500_000,
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

  // The authorization has to cover the budget the run will actually enforce,
  // or it bounds nothing until the money is already spent.
  it("refuses to start when the run's own budget cap exceeds the authorized cap", async () => {
    const runProbe = vi.fn();
    const result = await runCreativeSandboxCanary(
      { ...PROBE, maxMicromxn: 499_999 },
      deps({ pageBudgetCapMicromxn: 500_000, runProbe } as never),
    );
    expect(result).toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(runProbe).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN])("refuses an unusable page budget cap of %s", async (cap) => {
    const runProbe = vi.fn();
    const result = await runCreativeSandboxCanary(PROBE, deps({ pageBudgetCapMicromxn: cap, runProbe } as never));
    expect(result).toMatchObject({ ok: false, code: "invalid_budget" });
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

  it("names why the boundary threw instead of burying it in unexpected_error", async () => {
    // A whole cohort once reported `unexpected_error` seven times while the
    // process knew the exact reason. A canary that hides the one fact worth
    // having costs a paid run to learn what a string would have said.
    const runPage = async () => {
      throw new Error("page target/cap must be exactly 5000000/10000000 micromxn");
    };
    const result = await runCreativeSandboxCanary(PAGE, deps({ runPage } as never));

    expect(result.report.rows[0]).toMatchObject({
      resultCode: "unexpected_error",
      detail: "page target/cap must be exactly 5000000/10000000 micromxn",
    });
  });

  it("redacts a thrown message that carries a url or page bytes", async () => {
    // The redaction test below only ever runs the happy path, so `detail` is
    // the one field that could smuggle exactly what the artifact promises not
    // to hold — a fetch failure naming an endpoint is the ordinary case.
    const runPage = async () => {
      throw new Error('fetch failed https://api.fireworks.ai/v1/x for <!doctype html><body>');
    };
    const result = await runCreativeSandboxCanary(PAGE, deps({ runPage } as never));

    const serialized = JSON.stringify(result.report);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("<!doctype");
    // Still says what happened.
    expect(result.report.rows[0].detail).toContain("fetch failed");
  });

  it("keeps the thrown detail bounded and on one line", async () => {
    // The artifact carries accounting only — never prompts or page bytes. An
    // error message is the one place model output could ride in, so it is
    // truncated and flattened rather than trusted.
    const runPage = async () => {
      throw new Error(`<section>${"x".repeat(4000)}</section>\nsecond line`);
    };
    const result = await runCreativeSandboxCanary(PAGE, deps({ runPage } as never));

    const detail = result.report.rows[0].detail ?? "";
    expect(detail.length).toBeLessThanOrEqual(200);
    expect(detail).not.toContain("\n");
  });

  it("books an unmeasured throw at the cap without calling it money spent", async () => {
    // Reserving the cap is right — a throw can land AFTER paid turns, and
    // booking zero there would under-count real spend. What was wrong is
    // reporting a reservation in the same field a reader sums as spend.
    const runPage = async () => { throw new Error("boom"); };
    const result = await runCreativeSandboxCanary(PAGE, deps({ runPage } as never));

    expect(result.report.rows[0]).toMatchObject({ costMicromxn: 500_000, costMeasured: false });
    expect(result.report.totalCostMicromxn).toBe(500_000);
    expect(result.report.measuredCostMicromxn).toBe(0);
  });

  it("counts a cost the boundary actually reported as spend", async () => {
    const result = await runCreativeSandboxCanary(PAGE, deps());

    expect(result.report.rows[0]).toMatchObject({ costMicromxn: 100, costMeasured: true });
    expect(result.report.measuredCostMicromxn).toBe(100);
  });
});

describe("creative sandbox canary evidence", () => {
  it("produces a signed, redacted report for a passing page", async () => {
    const writeEvidence = vi.fn(async () => undefined);
    const result = await runCreativeSandboxCanary(PAGE, deps({ writeEvidence }));

    expect(result.ok).toBe(true);
    expect(result.report).toMatchObject({
      // 1.1 added `costMeasured` + `detail` per row and `measuredCostMicromxn`
      // to the report. A consumer reading a 1.0 artifact cannot tell a
      // reservation from spend, so the version has to say which one it holds.
      schemaVersion: "creative-sandbox-canary/1.1",
      commit: COMMIT,
      mode: "page:kids-coloring",
      totalCostMicromxn: 100,
      measuredCostMicromxn: 100,
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
