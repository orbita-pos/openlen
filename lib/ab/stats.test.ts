// @vitest-environment node
// Statistical engine tests for OpenLen Edge A/B Testing (Plan 3):
//   - Bayesian Beta-Binomial posterior accuracy (Gauss-Legendre 64-node)
//   - Always-valid sequential p-value peeking resistance (FPR < 5% over 21 days)
//   - Sample Ratio Mismatch (SRM) detection
//   - Harm guardrail (`harm_stop`) even prior to 72h minimum duration
//   - Minimum sample / duration / max-duration inconclusive guards
import { describe, expect, it } from "vitest";

import { evaluateAbStats, MIN_DURATION_HOURS, MIN_VIEWS_PER_VARIANT } from "./stats";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("evaluateAbStats", () => {
  it("declares winner_b when Variant B beats Control A with high confidence after 72h", () => {
    const res = evaluateAbStats({
      viewsA: 600,
      conversionsA: 24, // 4.0%
      viewsB: 600,
      conversionsB: 54, // 9.0%
      splitBps: 5000,
      durationHours: 96,
    });
    expect(res.verdict).toBe("winner_b");
    expect(res.winner).toBe("b");
    expect(res.probBBeatsA).toBeGreaterThan(0.99);
    expect(res.expectedLossB).toBeLessThan(0.002);
    expect(res.relativeLift).toBeGreaterThan(1.0);
    expect(res.alwaysValidP).toBeLessThan(0.05);
    expect(res.srmWarning).toBe(false);
  });

  it("declares winner_a when Control A clearly beats Variant B after 72h", () => {
    const res = evaluateAbStats({
      viewsA: 600,
      conversionsA: 54,
      viewsB: 600,
      conversionsB: 32,
      splitBps: 5000,
      durationHours: 96,
    });
    // Relative drop is ~40%, wait — let's pick a clean -25% drop that beats B without hitting 30% harm_stop
    const cleanA = evaluateAbStats({
      viewsA: 3000,
      conversionsA: 300, // 10.0%
      viewsB: 3000,
      conversionsB: 225, // 7.5% (-25%)
      splitBps: 5000,
      durationHours: 96,
    });
    expect(cleanA.verdict).toBe("winner_a");
    expect(cleanA.winner).toBe("a");
    expect(cleanA.probABeatsB).toBeGreaterThan(0.98);
    expect(res.probABeatsB).toBeGreaterThan(0.95);
  });

  it("stays collecting before 72h or below minimum sample thresholds", () => {
    const tooEarly = evaluateAbStats({
      viewsA: 600,
      conversionsA: 24,
      viewsB: 600,
      conversionsB: 54,
      splitBps: 5000,
      durationHours: MIN_DURATION_HOURS - 1,
    });
    expect(tooEarly.verdict).toBe("collecting");
    expect(tooEarly.winner).toBeNull();

    const tooFewViews = evaluateAbStats({
      viewsA: MIN_VIEWS_PER_VARIANT - 1,
      conversionsA: 2,
      viewsB: MIN_VIEWS_PER_VARIANT - 1,
      conversionsB: 15,
      splitBps: 5000,
      durationHours: 120,
    });
    expect(tooFewViews.verdict).toBe("collecting");

    const tooFewConvs = evaluateAbStats({
      viewsA: 300,
      conversionsA: 2,
      viewsB: 300,
      conversionsB: 7,
      splitBps: 5000,
      durationHours: 120,
    });
    expect(tooFewConvs.verdict).toBe("collecting");
  });

  it("triggers harm_stop immediately when Variant B collapses >30% at >=95% probability, even before 72h", () => {
    const res = evaluateAbStats({
      viewsA: 400,
      conversionsA: 44, // 11.0%
      viewsB: 400,
      conversionsB: 10, // 2.5%
      splitBps: 5000,
      durationHours: 24,
    });
    expect(res.verdict).toBe("harm_stop");
    expect(res.winner).toBe("a");
    expect(res.probHarm30).toBeGreaterThanOrEqual(0.95);
  });

  it("blocks verdict with srm_blocked when traffic split deviates sharply from 50/50", () => {
    const res = evaluateAbStats({
      viewsA: 680,
      conversionsA: 30,
      viewsB: 320,
      conversionsB: 35,
      splitBps: 5000,
      durationHours: 100,
    });
    expect(res.srmWarning).toBe(true);
    expect(res.verdict).toBe("srm_blocked");
    expect(res.winner).toBeNull();
  });

  it("declares inconclusive after 21 days when variants tie", () => {
    const res = evaluateAbStats({
      viewsA: 500,
      conversionsA: 25,
      viewsB: 500,
      conversionsB: 26,
      splitBps: 5000,
      durationHours: 21 * 24 + 1,
    });
    expect(res.verdict).toBe("inconclusive");
    expect(res.winner).toBeNull();
  });

  it("keeps false positive rate strictly under 5% under daily peeking across 200 A/A simulations", () => {
    const rng = mulberry32(20261119);
    const trials = 200;
    let falsePositives = 0;
    const trueRate = 0.05;

    for (let t = 0; t < trials; t++) {
      let viewsA = 0;
      let convA = 0;
      let viewsB = 0;
      let convB = 0;
      let triggered = false;
      for (let day = 1; day <= 21 && !triggered; day++) {
        // 80 visitors per day split 50/50
        for (let i = 0; i < 40; i++) {
          viewsA++;
          if (rng() < trueRate) convA++;
          viewsB++;
          if (rng() < trueRate) convB++;
        }
        const res = evaluateAbStats({
          viewsA,
          conversionsA: convA,
          viewsB,
          conversionsB: convB,
          splitBps: 5000,
          durationHours: day * 24,
        });
        if (res.verdict === "winner_b" || res.verdict === "winner_a" || res.verdict === "harm_stop") {
          triggered = true;
          falsePositives++;
        }
      }
    }

    const fpr = falsePositives / trials;
    expect(fpr).toBeLessThan(0.05);
  });
});
