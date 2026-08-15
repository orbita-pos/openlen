import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { runCreativeGeneration, type CreativeGenerationDeps } from "./run-creative-generation";

const BASELINE_HTML = "<!doctype html><html><body><section>baseline</section></body></html>";
const IMPROVED_HTML = "<!doctype html><html><body><section>improved</section></body></html>";

const VISUAL_ENGINE = { schemaVersion: "visual-engine-project/1.0", route: "section_composition", templateId: null } as never;

const BASELINE: SafeCreativeCandidate = {
  html: BASELINE_HTML, title: "Mundo Pincel", visualEngine: VISUAL_ENGINE,
  filled: true, appliedOps: 5, source: "baseline",
};
const IMPROVED: SafeCreativeCandidate = { ...BASELINE, html: IMPROVED_HTML, source: "deepseek" };

const INPUT = {
  projectId: "11111111-1111-4111-8111-111111111111",
  brief: "Una página de terror con estética VHS",
  profileData: { brand: { accent: "#000", logoUrl: null } } as never,
  records: [{ id: "hero-one", type: "hero" }] as never,
};

function deps(over: Partial<CreativeGenerationDeps> = {}): CreativeGenerationDeps {
  return {
    buildBaseline: async () => ({ ok: true, candidate: BASELINE, intent: { language: "es" } as never, copy: {} as never }),
    runCreativeSession: async () => ({ candidate: IMPROVED, changed: true, acceptedMutations: 2, stoppedBy: "finished" }),
    runAdvisoryReview: async ({ candidate }) => ({ candidate, reviewed: true, repaired: false }),
    validateDelivery: (({ visualEngine }: { visualEngine: unknown }) => ({ ok: true, visualEngine })) as never,
    ...over,
  };
}

describe("creative generation orchestration", () => {
  it("delivers the improved candidate when every stage works", async () => {
    const result = await runCreativeGeneration(INPUT, deps());
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, degraded: false });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
    expect(result.ok && result.title).toBe("Mundo Pincel");
  });

  it.each([
    ["deepseek_missing_key", { stoppedBy: "provider" as const }],
    ["deepseek_timeout", { stoppedBy: "provider" as const }],
    ["deepseek_invalid_tool", { stoppedBy: "provider" as const }],
    ["deepseek_budget", { stoppedBy: "budget" as const }],
  ])("delivers lastKnownGood on %s", async (_name, over) => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: BASELINE, changed: false, acceptedMutations: 0, ...over }),
    }));
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
  });

  it("delivers lastKnownGood when the creative session throws outright", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => { throw new Error("transport exploded"); },
    }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
  });

  it.each(["qwen_timeout", "qwen_malformed", "qwen_reject"])("delivers the page on %s", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runAdvisoryReview: async ({ candidate }) => ({ candidate, reviewed: false, repaired: false }),
    }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
  });

  it("delivers the page when the advisory review throws", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runAdvisoryReview: async () => { throw new Error("qwen down"); },
    }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
  });

  it("fails only when no safe baseline can be built", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => ({ ok: false, code: "section_inventory_unavailable" }),
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition", reasonCode: "section_inventory_unavailable" });
  });

  it("fails when the baseline builder itself throws", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => { throw new Error("catalog down"); },
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition" });
  });

  it("falls back to the baseline when the improved candidate fails final delivery", async () => {
    const validateDelivery = vi.fn(({ html, visualEngine }: { html: string; visualEngine: unknown }) => (html === IMPROVED_HTML
      ? { ok: false as const, reasonCode: "invalid_composition_metadata" as const }
      : { ok: true as const, visualEngine }));
    const result = await runCreativeGeneration(INPUT, deps({ validateDelivery: validateDelivery as never }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
    expect(validateDelivery).toHaveBeenCalledTimes(2);
  });

  it("aborts only when both the improvement and the baseline fail delivery", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      validateDelivery: (() => ({ ok: false, reasonCode: "invalid_composition_metadata" })) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "delivery_gate", reasonCode: "invalid_composition_metadata" });
  });

  it("reports progress in the cutover order", async () => {
    const stages: string[] = [];
    await runCreativeGeneration({ ...INPUT, onStage: (stage) => stages.push(stage) }, deps());
    expect(stages).toEqual(["baseline", "creative", "review", "delivery_gate"]);
  });

  it("never lets a progress callback change delivery", async () => {
    const result = await runCreativeGeneration(
      { ...INPUT, onStage: () => { throw new Error("ui blew up"); } },
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  it("records a redacted failure for a degraded delivery without aborting", async () => {
    const recordFailure = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: BASELINE, changed: false, acceptedMutations: 0, stoppedBy: "provider" }),
      recordFailure,
    }));
    expect(result.ok).toBe(true);
    expect(recordFailure).toHaveBeenCalledWith("creative_session", "provider");
    expect(JSON.stringify(recordFailure.mock.calls)).not.toContain("<!doctype");
  });

  it("passes the baseline's own intent and copy into the creative session", async () => {
    const runCreativeSession = vi.fn(async (_input: { baseline: SafeCreativeCandidate; brief: string }) => ({ candidate: IMPROVED, changed: true, acceptedMutations: 1, stoppedBy: "finished" as const }));
    await runCreativeGeneration(INPUT, deps({ runCreativeSession }));
    expect(runCreativeSession.mock.calls[0][0]).toMatchObject({ baseline: BASELINE, brief: INPUT.brief });
  });
});
