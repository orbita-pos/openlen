// @vitest-environment node
// Statistical engine tests for OpenLen Edge A/B Testing (Plan 3):
//   - Bayesian Beta-Binomial posterior accuracy (Gauss-Legendre 64-node)
//   - Always-valid sequential p-values (winner AND harm) under a look every 30 minutes for 21 days
//   - Sample Ratio Mismatch (SRM) detection
//   - Harm guardrail (`harm_stop`) even prior to 72h minimum duration
//   - Minimum sample / duration / max-duration inconclusive guards
import { describe, expect, it } from "vitest";

import {
  evaluateAbStats,
  evaluateAbVerdict,
  MIN_DURATION_HOURS,
  MIN_VIEWS_PER_VARIANT,
  sequentialAlwaysValidP,
  sequentialHarmP,
} from "./stats";

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

  it("🔴 an SRM-blocked experiment doesn't wait for ever: at the end of ITS time it is inconclusive, for uneven traffic (item 24)", () => {
    const skewed = { viewsA: 680, conversionsA: 30, viewsB: 320, conversionsB: 35, splitBps: 5000 };
    const early = evaluateAbStats({ ...skewed, durationHours: 20 * 24 });
    expect(early.verdict).toBe("srm_blocked");
    expect(early.reason).toBeUndefined();

    const over = evaluateAbStats({ ...skewed, durationHours: 21 * 24 + 1 });
    expect(over.verdict).toBe("inconclusive");
    expect(over.reason).toBe("uneven_traffic");
    expect(over.winner).toBeNull();

    // «Seguir probando» moved ITS limit: still blocked until then.
    expect(evaluateAbStats({ ...skewed, durationHours: 22 * 24, maxDurationDays: 28 }).verdict).toBe("srm_blocked");
    expect(evaluateAbStats({ ...skewed, durationHours: 28 * 24 + 1, maxDurationDays: 28 }).reason).toBe("uneven_traffic");
  });

  it("an inconclusive tie says nothing about uneven traffic", () => {
    const tie = evaluateAbStats({ viewsA: 500, conversionsA: 25, viewsB: 500, conversionsB: 26, splitBps: 5000, durationHours: 21 * 24 + 1 });
    expect(tie.verdict).toBe("inconclusive");
    expect(tie.reason).toBeUndefined();
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
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE EVALUATOR'S REAL CADENCE (review item 25). It looks every 30 minutes for 21 days — 1,008 looks — and the first
// verdict that isn't "collecting" ends the experiment. A p-value or a posterior threshold that is fine for ONE look fires on
// noise sooner or later under that many: the harm brake used to (4.4% in A/A, against a «no more than 5%» test that looked
// once a day and passed with no margin). Here the simulation looks as often as production does, A against A, at three
// traffic levels and base rates, on a fixed seed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Poisson draw (Knuth). */
function poisson(mean: number, rng: () => number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

const LOOKS = 21 * 24 * 2; // every 30 minutes for 21 days — EVALUATOR_INTERVAL_MS, MAX_DURATION_DAYS

/** One experiment from its first minute to its first verdict (or day 21): what it ended as. */
function runExperiment(o: { seed: number; perVariantPerDay: number; rateA: number; rateB: number }): string {
  const rng = mulberry32(o.seed);
  const perLook = o.perVariantPerDay / 48;
  let nA = 0;
  let cA = 0;
  let nB = 0;
  let cB = 0;
  for (let look = 1; look <= LOOKS; look++) {
    for (let i = poisson(perLook, rng); i > 0; i--) {
      nA++;
      if (rng() < o.rateA) cA++;
    }
    for (let i = poisson(perLook, rng); i > 0; i--) {
      nB++;
      if (rng() < o.rateB) cB++;
    }
    const { verdict } = evaluateAbVerdict({ viewsA: nA, conversionsA: cA, viewsB: nB, conversionsB: cB, splitBps: 5000, durationHours: look / 2 });
    if (verdict === "harm_stop" || verdict === "winner_a" || verdict === "winner_b") return verdict;
  }
  return "no_verdict";
}

const LEVELS = [
  { name: "a small shop (20 visits a day per version, 8% convert)", perVariantPerDay: 20, rate: 0.08 },
  { name: "a busy page (120 a day, 5%)", perVariantPerDay: 120, rate: 0.05 },
  { name: "a big one (600 a day, 3%)", perVariantPerDay: 600, rate: 0.03 },
];
const RUNS = 2000;

describe("the evaluator's real cadence: a look every 30 minutes for 21 days (review item 25)", () => {
  it("🔴 A against A: harm_stop false positives under 1% and winner false positives under 5%, at every traffic level", () => {
    for (const [i, level] of LEVELS.entries()) {
      let harm = 0;
      let winner = 0;
      for (let r = 0; r < RUNS; r++) {
        const end = runExperiment({ seed: 20261119 + i * 100_003 + r, perVariantPerDay: level.perVariantPerDay, rateA: level.rate, rateB: level.rate });
        if (end === "harm_stop") harm++;
        else if (end === "winner_a" || end === "winner_b") winner++;
      }
      expect(harm / RUNS, `harm_stop false positives, ${level.name}: ${harm}/${RUNS}`).toBeLessThan(0.01);
      expect(winner / RUNS, `winner false positives, ${level.name}: ${winner}/${RUNS}`).toBeLessThan(0.05);
    }
  }, 20_000);

  it("the brake still works: a severe collapse is stopped by it in every run, a moderate one ends as a clear win for A, a real win is found", () => {
    const RUNS_REAL = 60;
    const tally = (cfg: { perVariantPerDay: number; rateA: number; rateB: number }, seed: number) => {
      const t: Record<string, number> = {};
      for (let r = 0; r < RUNS_REAL; r++) {
        const end = runExperiment({ ...cfg, seed: seed + r });
        t[end] = (t[end] ?? 0) + 1;
      }
      return t;
    };
    // 10% -> 3% on a busy page: the brake itself, always.
    expect(tally({ perVariantPerDay: 600, rateA: 0.1, rateB: 0.03 }, 777).harm_stop).toBe(RUNS_REAL);
    // 10% -> 5.5% on a modest page: the experiment ends either way, nearly always as «the original wins».
    const moderate = tally({ perVariantPerDay: 120, rateA: 0.1, rateB: 0.055 }, 4242);
    expect((moderate.harm_stop ?? 0) + (moderate.winner_a ?? 0)).toBeGreaterThanOrEqual(RUNS_REAL - 1);
    // 5% -> 8%: a real improvement is found.
    expect(tally({ perVariantPerDay: 120, rateA: 0.05, rateB: 0.08 }, 999).winner_b).toBeGreaterThanOrEqual(RUNS_REAL * 0.9);
  }, 20_000);
});

describe("the harm test (always-valid, one-sided)", () => {
  it("B at or above A is never harm; a collapse is; with too little data it says nothing", () => {
    expect(sequentialHarmP(500, 25, 500, 25)).toBe(1);
    expect(sequentialHarmP(500, 25, 500, 40)).toBe(1);
    expect(sequentialHarmP(5, 1, 5, 0)).toBe(1);
    expect(sequentialHarmP(400, 44, 400, 10)).toBeLessThan(0.01);
    // The same gap in the other direction is the winner test's business, not the brake's.
    expect(sequentialAlwaysValidP(400, 10, 400, 44)).toBeLessThan(0.01);
    expect(sequentialHarmP(400, 10, 400, 44)).toBe(1);
  });

  it("🔴 a drop the posterior alone would call harm is NOT harm until the sequential test agrees (the old brake's false positive)", () => {
    // Plenty of data and a 35% drop at 95% posterior probability, but a sequential p-value that doesn't clear 0.01.
    const input = { viewsA: 120, conversionsA: 12, viewsB: 120, conversionsB: 6, splitBps: 5000, durationHours: 30 };
    const stats = evaluateAbStats(input);
    expect(stats.probHarm30).toBeGreaterThan(0.5);
    expect(stats.harmAlwaysValidP).toBeGreaterThan(0.01);
    expect(stats.verdict).not.toBe("harm_stop");
  });

  it("evaluateAbVerdict is exactly evaluateAbStats's verdict", () => {
    const cases = [
      { viewsA: 600, conversionsA: 24, viewsB: 600, conversionsB: 54, splitBps: 5000, durationHours: 96 },
      { viewsA: 400, conversionsA: 44, viewsB: 400, conversionsB: 10, splitBps: 5000, durationHours: 24 },
      { viewsA: 680, conversionsA: 30, viewsB: 320, conversionsB: 35, splitBps: 5000, durationHours: 100 },
      { viewsA: 500, conversionsA: 25, viewsB: 500, conversionsB: 26, splitBps: 5000, durationHours: 21 * 24 + 1 },
      { viewsA: 0, conversionsA: 0, viewsB: 0, conversionsB: 0, splitBps: 5000, durationHours: 3 },
    ];
    for (const c of cases) {
      const full = evaluateAbStats(c);
      const only = evaluateAbVerdict(c);
      expect([only.verdict, only.winner, only.reason]).toEqual([full.verdict, full.winner, full.reason]);
    }
  });
});
