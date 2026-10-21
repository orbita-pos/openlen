// @vitest-environment node
import { describe, expect, it } from "vitest";
import { requireTrialDatabase, trialSpend, trialAllows, type TrialLimits } from "./trial-budget";

const limits: TrialLimits = { capUsd: 3, worstCaseUsd: { image: 0.12, audio: 0.1 }, maxCalls: { image: 6, audio: 2 } };

describe("the paid trial's budget", () => {
  it("counts a known provider cost as itself and an unknown or open one at its worst case", () => {
    expect(trialSpend(0.4, [{ kind: "image", costMicroUsd: 50_000 }, { kind: "audio", costMicroUsd: null }, { kind: "image", costMicroUsd: null }], limits)).toBeCloseTo(0.4 + 0.05 + 0.1 + 0.12, 6);
  });

  it("allows the next paid call only if its worst case still fits under the cap", () => {
    expect(trialAllows("image", 2.8, [], limits)).toEqual({ ok: true });
    expect(trialAllows("image", 2.9, [], limits)).toMatchObject({ ok: false });
    expect(trialAllows("audio", 2.85, [{ kind: "image", costMicroUsd: 60_000 }], limits)).toMatchObject({ ok: false });
  });

  it("stops at the per-kind call limit whatever the money says", () => {
    const six = Array.from({ length: 6 }, () => ({ kind: "image" as const, costMicroUsd: 1 }));
    expect(trialAllows("image", 0, six, limits)).toMatchObject({ ok: false, reason: expect.stringContaining("image") });
    expect(trialAllows("audio", 0, six, limits)).toEqual({ ok: true });
  });

  it("refuses an unknown kind instead of guessing its price", () => {
    expect(trialAllows("render" as never, 0, [], limits)).toMatchObject({ ok: false });
  });
});

describe("the trial's database", () => {
  it("is only ever a local throwaway one", () => {
    expect(requireTrialDatabase("postgres://u:p@127.0.0.1:5432/openlen_codex_test_20261018_ba74fdb1")).toBe("openlen_codex_test_20261018_ba74fdb1");
    expect(requireTrialDatabase("postgresql://u@localhost/openlen_trial_20261020")).toBe("openlen_trial_20261020");
    for (const url of ["postgres://u:p@127.0.0.1:5432/openlen", "postgres://u:p@178.156.175.171:5432/openlen_trial_x", "postgres://u:p@db.example.com/openlen_codex_test_x", "not a url", ""]) {
      expect(() => requireTrialDatabase(url)).toThrow();
    }
  });
});
