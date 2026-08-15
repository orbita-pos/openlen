import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { runAdvisoryVisualReview, type AdvisoryReviewDeps } from "./advisory-visual-review";

const CANDIDATE: SafeCreativeCandidate = {
  html: "<!doctype html><html><body><section>safe</section></body></html>",
  title: "Marca",
  visualEngine: { route: "section_composition", templateId: null } as never,
  filled: true,
  appliedOps: 4,
  source: "deepseek",
};

const REPAIRED: SafeCreativeCandidate = { ...CANDIDATE, html: "<!doctype html><html><body><section>repaired</section></body></html>", source: "deepseek_repair" };

const INPUT = { requestId: "page-1", brief: "terror vhs", candidate: CANDIDATE };

function deps(over: Partial<AdvisoryReviewDeps> = {}): AdvisoryReviewDeps {
  return {
    render: async () => ({ mobileOverflow: false, invalidGeometry: false }),
    review: async () => ({ ok: true as const, accepted: true, issues: [] }),
    repair: async () => ({ candidate: REPAIRED, changed: true, acceptedMutations: 1, stoppedBy: "finished" as const }),
    ...over,
  };
}

describe("advisory visual review", () => {
  it("delivers the candidate untouched when Qwen accepts", async () => {
    const repair = vi.fn();
    const result = await runAdvisoryVisualReview(INPUT, deps({ repair: repair as never }));
    expect(result).toMatchObject({ reviewed: true, repaired: false });
    expect(result.candidate).toEqual(CANDIDATE);
    expect(repair).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", { review: async () => ({ ok: false as const }) }],
    ["malformed", { review: async () => ({ ok: true as const, accepted: undefined as never, issues: undefined as never }) }],
    ["throws", { review: async () => { throw new Error("qwen down"); } }],
  ])("cannot veto the page when Qwen is %s", async (_name, over) => {
    const result = await runAdvisoryVisualReview(INPUT, deps(over as Partial<AdvisoryReviewDeps>));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it("allows exactly one repair turn when Qwen asks for improvement", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["hero reads generic"] }));
    const repair = vi.fn(async () => ({ candidate: REPAIRED, changed: true, acceptedMutations: 1, stoppedBy: "finished" as const }));
    const result = await runAdvisoryVisualReview(INPUT, deps({ review, repair }));
    expect(result).toMatchObject({ reviewed: true, repaired: true });
    expect(result.candidate).toEqual(REPAIRED);
    expect(review).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("passes the reviewer's issues into the repair turn", async () => {
    const repair = vi.fn(async (_input: { issueSummary: string }) => ({ candidate: REPAIRED, changed: true, acceptedMutations: 1, stoppedBy: "finished" as const }));
    await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["hero reads generic", "palette is muddy"] }),
      repair,
    }));
    expect(String(repair.mock.calls[0][0].issueSummary)).toContain("hero reads generic");
  });

  it("keeps the pre-review candidate when the repair changes nothing", async () => {
    const result = await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      repair: async () => ({ candidate: CANDIDATE, changed: false, acceptedMutations: 0, stoppedBy: "provider" as const }),
    }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it("keeps the pre-review candidate when the repair turn throws", async () => {
    const result = await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      repair: async () => { throw new Error("provider down"); },
    }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it.each([
    ["overflows on mobile", { mobileOverflow: true, invalidGeometry: false }],
    ["has invalid geometry", { mobileOverflow: false, invalidGeometry: true }],
  ])("reverts a repair that %s deterministically", async (_name, bad) => {
    let call = 0;
    const result = await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      render: async () => (call++ === 0 ? { mobileOverflow: false, invalidGeometry: false } : bad),
    }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it("renders once for the review and never calls Qwen twice", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["x"] }));
    await runAdvisoryVisualReview(INPUT, deps({ review }));
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("delivers the candidate even when the pre-review render is unavailable", async () => {
    const result = await runAdvisoryVisualReview(INPUT, deps({ render: async () => null }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.reviewed).toBe(false);
  });
});
