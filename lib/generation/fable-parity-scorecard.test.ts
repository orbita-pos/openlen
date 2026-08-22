import { describe, expect, it } from "vitest";

import { canonicalJsonSha256 } from "./content-hash";
import {
  scoreFableParity,
  sealFableParityScorecard,
  verifyFableParityScorecard,
  type BlindDecision,
  type FableParityComparisonResult,
} from "./fable-parity-scorecard";

const RUBRIC = { niche: 8, fidelity: 8, polish: 8, coherence: 8, usability: 8 } as const;
const ARTIFACT_MANIFEST_SHA256 = `sha256:${"c".repeat(64)}`;
const RELEASE_PROVENANCE = {
  authorizationManifestSha256: `sha256:${"a".repeat(64)}`,
  cohortVersion: "fable-parity-cohort/1",
  cohortSha256: `sha256:${"d".repeat(64)}`,
  sourceRevision: "bcb19ccd00f36e0a901ae2731e96f88bc8632b08",
  buildId: "openlen-build-20260813",
  artifactDigest: `sha256:${"b".repeat(64)}`,
  immutableRateCardSha256: `sha256:${"e".repeat(64)}`,
  rolloutPercent: 10,
} as const;

type Outcome = "win" | "tie" | "loss";

function comparison(index: number, overrides: Partial<FableParityComparisonResult> = {}): FableParityComparisonResult {
  return {
    comparisonId: `comparison-${String(index + 1).padStart(2, "0")}`,
    openLenSide: index % 2 === 0 ? "A" : "B",
    technicalStatus: "ok",
    openLenEligible: true,
    criticalFailures: [],
    paidCalls: [{ result: "delivered", costMicromxn: 1_000_000 }],
    referencePaidCalls: [{ result: "delivered", costMicromxn: 500_000 }],
    openLenRequestSha256: `sha256:${"1".repeat(64)}`,
    fableRequestSha256: `sha256:${"2".repeat(64)}`,
    openLenAttestationSha256: `sha256:${"3".repeat(64)}`,
    fableAttestationSha256: `sha256:${"4".repeat(64)}`,
    ...overrides,
  };
}

function decision(row: FableParityComparisonResult, reviewer: number, outcome: Outcome): BlindDecision {
  const openLen = row.openLenSide;
  const fable = openLen === "A" ? "B" : "A";
  return {
    comparisonId: row.comparisonId,
    reviewerSessionId: `reviewer-${reviewer}`,
    desktopPreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
    mobilePreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
    overallPreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
    wrongNicheSide: "none",
    rubric: RUBRIC,
  };
}

function fixture(outcomes: readonly Outcome[] = [
  ...Array<Outcome>(8).fill("win"),
  ...Array<Outcome>(6).fill("tie"),
  ...Array<Outcome>(6).fill("loss"),
]) {
  const comparisons = Array.from({ length: 20 }, (_, index) => comparison(index, {
    openLenEligible: index < 18,
  }));
  const decisions = comparisons.flatMap((row, index) => [1, 2, 3].map((reviewer) => decision(row, reviewer, outcomes[index]!)));
  return { comparisons, decisions };
}

describe("Fable parity immutable scorecard", () => {
  it("passes only the literal release boundary and neutralizes alternating A/B sides", () => {
    const input = fixture();
    expect(scoreFableParity(input)).toEqual({
      comparisons: 20,
      eligibleOpenLenPages: 18,
      nonLossRate: 0.7,
      outrightWinRate: 0.4,
      wrongNicheCount: 0,
      medianCostMicromxn: 1_000_000,
      maxCostMicromxn: 1_000_000,
      passed: true,
      failures: [],
    });
  });

  it("counts every technical failure as a loss without changing the denominator", () => {
    const input = fixture();
    input.comparisons[0] = comparison(0, {
      openLenEligible: false,
      technicalStatus: "openlen_failure",
      paidCalls: [{ result: "failed", costMicromxn: 2_000_000 }],
    });
    const score = scoreFableParity(input);
    expect(score.comparisons).toBe(20);
    expect(score.nonLossRate).toBe(0.65);
    expect(score.passed).toBe(false);
    expect(score.failures).toContain("non_loss_rate_below_70_percent");
  });

  it("rejects failed-but-eligible rows instead of letting six failures satisfy the ninety-percent gate", () => {
    const input = fixture([
      ...Array<Outcome>(6).fill("loss"),
      ...Array<Outcome>(8).fill("win"),
      ...Array<Outcome>(6).fill("tie"),
    ]);
    for (let index = 0; index < 6; index += 1) {
      input.comparisons[index] = comparison(index, {
        technicalStatus: "openlen_failure",
        openLenEligible: true,
        paidCalls: [{ result: "failed", costMicromxn: 500_000 }],
      });
    }
    expect(() => scoreFableParity(input)).toThrow(/eligible|technical|failure/i);
  });

  it("rejects successful comparison rows with empty or zero paid accounting", () => {
    const input = fixture();
    input.comparisons[0] = comparison(0, { paidCalls: [] });
    expect(() => scoreFableParity(input)).toThrow(/paid|cost|ledger/i);
    input.comparisons[0] = comparison(0, { paidCalls: [{ result: "delivered", costMicromxn: 0 }] });
    expect(() => scoreFableParity(input)).toThrow(/paid|cost|ledger/i);
  });

  it("includes failed paid calls in per-page cost and fails at the 10 MXN boundary", () => {
    const input = fixture();
    input.comparisons[19] = comparison(19, {
      openLenEligible: false,
      paidCalls: [
        { result: "failed", costMicromxn: 6_000_000 },
        { result: "delivered", costMicromxn: 4_000_000 },
      ],
    });
    const score = scoreFableParity(input);
    expect(score.maxCostMicromxn).toBe(10_000_000);
    expect(score.failures).toContain("page_cost_not_below_10_mxn");
  });

  it.each([
    ["eligible pages", (input: ReturnType<typeof fixture>) => { input.comparisons[17] = { ...input.comparisons[17]!, openLenEligible: false }; }, "eligible_openlen_pages_below_90_percent"],
    ["wrong niche", (input: ReturnType<typeof fixture>) => {
      for (const row of input.decisions.filter((row) => row.comparisonId === "comparison-01").slice(0, 2)) row.wrongNicheSide = "A";
    }, "wrong_niche_identity"],
    ["critical safety", (input: ReturnType<typeof fixture>) => { input.comparisons[0] = { ...input.comparisons[0]!, criticalFailures: ["whole_template_clone"] }; }, "critical_release_failure"],
    ["median cost", (input: ReturnType<typeof fixture>) => {
      for (let index = 0; index < 11; index += 1) input.comparisons[index] = comparison(index, { openLenEligible: index < 18, paidCalls: [{ result: "delivered", costMicromxn: 5_000_001 }] });
    }, "median_cost_above_5_mxn"],
  ] as const)("fails the immutable %s threshold", (_label, mutate, expectedFailure) => {
    const input = fixture();
    mutate(input);
    const score = scoreFableParity(input);
    expect(score.passed).toBe(false);
    expect(score.failures).toContain(expectedFailure);
  });

  it("allows the outright-win exception only when ties alone reach eighty percent", () => {
    const insufficient = fixture([...Array<Outcome>(7).fill("win"), ...Array<Outcome>(7).fill("tie"), ...Array<Outcome>(6).fill("loss")]);
    expect(scoreFableParity(insufficient).failures).toContain("outright_win_rate_below_40_percent");

    const reviewerEquivalent = fixture([...Array<Outcome>(16).fill("tie"), ...Array<Outcome>(4).fill("loss")]);
    expect(scoreFableParity(reviewerEquivalent)).toMatchObject({ nonLossRate: 0.8, outrightWinRate: 0, passed: true });
  });

  it("rejects incomplete, duplicate, or non-independent reviewer decisions", () => {
    const input = fixture();
    expect(() => scoreFableParity({ ...input, decisions: input.decisions.slice(0, -1) })).toThrow(/exactly three|coverage|decision/i);
    expect(() => scoreFableParity({ ...input, decisions: [...input.decisions, input.decisions[0]!] })).toThrow(/duplicate|decision/i);
    const repeated = input.decisions.map((row) => ({ ...row, reviewerSessionId: "one-reviewer" }));
    expect(() => scoreFableParity({ ...input, decisions: repeated })).toThrow(/independent|reviewer/i);
  });

  it("seals the verified scorecard and rejects any post-decision mutation", () => {
    const sealed = (sealFableParityScorecard as Function)(fixture(), ARTIFACT_MANIFEST_SHA256, RELEASE_PROVENANCE);
    expect(sealed).toMatchObject({ schemaVersion: "fable-parity-scorecard/2.0", source: RELEASE_PROVENANCE });
    expect(verifyFableParityScorecard(sealed)).toEqual(sealed.score);
    const mutated = structuredClone(sealed);
    mutated.score.nonLossRate = 1;
    expect(() => verifyFableParityScorecard(mutated)).toThrow(/hash|immutable|scorecard/i);
  });

  it("rejects a forged passing score even when the attacker recomputes the unkeyed envelope hash", () => {
    const failing = fixture(Array<Outcome>(20).fill("loss"));
    const forged = structuredClone((sealFableParityScorecard as Function)(failing, ARTIFACT_MANIFEST_SHA256, RELEASE_PROVENANCE));
    forged.score.passed = true;
    forged.score.failures = [];
    const { scorecardSha256: _oldHash, ...unsigned } = forged;
    Object.assign(forged, { scorecardSha256: canonicalJsonSha256(unsigned) });
    expect(() => verifyFableParityScorecard(forged)).toThrow(/recomputed|score|source|evidence/i);
  });

  it("binds the normalized comparisons and decisions to the exact artifact manifest hash", () => {
    const sealed = (sealFableParityScorecard as Function)(fixture(), ARTIFACT_MANIFEST_SHA256, RELEASE_PROVENANCE);
    expect(sealed.source.artifactManifestSha256).toBe(ARTIFACT_MANIFEST_SHA256);
    const rebound = structuredClone(sealed);
    rebound.source.artifactManifestSha256 = `sha256:${"d".repeat(64)}`;
    const { scorecardSha256: _oldHash, ...unsigned } = rebound;
    Object.assign(rebound, { scorecardSha256: canonicalJsonSha256(unsigned) });
    expect(() => verifyFableParityScorecard(rebound)).toThrow(/evidence|source|manifest/i);
  });

  it.each([
    ["source revision", { sourceRevision: "a".repeat(40) }],
    ["build identity", { buildId: "stale-build" }],
    ["artifact digest", { artifactDigest: `sha256:${"d".repeat(64)}` }],
    ["rollout percent", { rolloutPercent: 99 }],
  ])("rejects sealed release provenance tampering in %s", (_label, mutation) => {
    const sealed = (sealFableParityScorecard as Function)(fixture(), ARTIFACT_MANIFEST_SHA256, RELEASE_PROVENANCE);
    const mutated = structuredClone(sealed);
    Object.assign(mutated.source, mutation);
    expect(() => verifyFableParityScorecard(mutated)).toThrow(/source|evidence|hash|revision|build|rollout/i);
  });
});
