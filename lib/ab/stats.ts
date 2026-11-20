// Deterministic Bayesian Beta-Binomial + Sequential mSPRT + SRM statistical engine
// for OpenLen Edge A/B Testing (Plan 3).
//
// Zero external dependencies, zero randomness (no Monte Carlo):
// - Weakly informative symmetric prior Beta(alpha0=1, beta0=19) (~5% baseline).
// - Exact integration via 64-point Gauss-Legendre quadrature over [0, 1] using
//   Lanczos lnGamma and Lentz continued-fraction regularized incomplete beta.
// - Sequential always-valid p-value (mixture SPRT, Johari et al.) prevents
//   peeking false positives when evaluated every 30 minutes over 21 days.
// - Sample Ratio Mismatch (chi-square 1 df, p < 0.001) blocks auto-winner on skew.

import type { AbInconclusiveReason, AbStatsResult, AbVariant, AbVerdict } from "./types";

export const PRIOR_ALPHA = 1;
export const PRIOR_BETA = 19;

export const MIN_VIEWS_PER_VARIANT = 100;
export const MIN_TOTAL_CONVERSIONS = 10;
export const MIN_LEADER_CONVERSIONS = 5;
export const MIN_DURATION_HOURS = 72;
export const MIN_RELATIVE_LIFT = 0.10;
export const WIN_PROBABILITY = 0.95;
export const MAX_EXPECTED_LOSS = 0.002;
export const MAX_ALWAYS_VALID_P = 0.05;
export const MAX_DURATION_DAYS = 21;

export const HARM_MIN_VIEWS_PER_VARIANT = 50;
export const HARM_MIN_DURATION_HOURS = 24;
export const HARM_MIN_CONTROL_CONVERSIONS = 5;
export const HARM_DROP_RATIO = 0.70;
export const HARM_PROBABILITY = 0.95;
/** The harm brake needs an ALWAYS-VALID test too, much stricter than the winner's: the evaluator looks every 30 minutes
 *  for three weeks, and a brake that fires on noise tells the owner their change hurt them when it didn't. */
export const HARM_MAX_ALWAYS_VALID_P = 0.01;

export const SRM_MIN_TOTAL_VIEWS = 200;
export const SRM_CHI2_CRITICAL = 10.828; // p = 0.001 for df = 1

// Lanczos approximation (g = 7, n = 9) — accurate to ~1e-15 for x > 0.
const LANCZOS_P = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  const zm1 = z - 1;
  let x = LANCZOS_P[0]!;
  for (let i = 1; i < LANCZOS_P.length; i++) {
    x += LANCZOS_P[i]! / (zm1 + i);
  }
  const t = zm1 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnBeta(a, b));
}

// Regularized incomplete beta I_x(a, b) via modified Lentz continued fraction.
function betacf(a: number, b: number, x: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta(a, b));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// Compute N-point Gauss-Legendre nodes & weights on [-1, 1] once via Newton-Raphson.
function buildGaussLegendre(n: number): { nodes: Float64Array; weights: Float64Array } {
  const nodes = new Float64Array(n);
  const weights = new Float64Array(n);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let iter = 0; iter < 50; iter++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    nodes[i] = -z;
    nodes[n - 1 - i] = z;
    const w = 2 / ((1 - z * z) * pp * pp);
    weights[i] = w;
    weights[n - 1 - i] = w;
  }
  return { nodes, weights };
}

const GL64 = buildGaussLegendre(64);

/** Integrate f(x) over [lo, hi] with 64-point Gauss-Legendre quadrature. */
function integrate(f: (x: number) => number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  const half = 0.5 * (hi - lo);
  const mid = 0.5 * (hi + lo);
  let sum = 0;
  for (let i = 0; i < GL64.nodes.length; i++) {
    sum += GL64.weights[i]! * f(mid + half * GL64.nodes[i]!);
  }
  return half * sum;
}

/** Tight support window [lo, hi] capturing > 99.999999% of Beta(a, b) mass
 *  so 64-node quadrature resolves very peaked posteriors (high n) accurately. */
function betaSupport(a: number, b: number): [number, number] {
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) * (a + b) * (a + b + 1)));
  const lo = Math.max(0, mean - 8 * sd);
  const hi = Math.min(1, mean + 8 * sd);
  return [lo, hi];
}

/** Exact deterministic P(X_b > scale * X_a) where X_a ~ Beta(aA, bA), X_b ~ Beta(aB, bB). */
export function probBetaExceedsScaled(
  aA: number,
  bA: number,
  aB: number,
  bB: number,
  scale = 1,
): number {
  const [loA, hiA] = betaSupport(aA, bA);
  const val = integrate(
    (x) => {
      const threshold = scale * x;
      if (threshold >= 1) return 0;
      const pBLarger = 1 - betaCdf(threshold, aB, bB);
      return betaPdf(x, aA, bA) * pBLarger;
    },
    loA,
    hiA,
  );
  return Math.min(1, Math.max(0, val));
}

/** Expected loss E[max(X_a - X_b, 0)] if we choose B over A. */
export function expectedLossChooseB(aA: number, bA: number, aB: number, bB: number): number {
  // E[max(X_a - X_b, 0)] = E[X_a * 1{X_a > X_b}] - E[X_b * 1{X_a > X_b}]
  // Using Beta identity: x * f_Beta(x; a, b) = (a/(a+b)) * f_Beta(x; a+1, b).
  const meanA = aA / (aA + bA);
  const meanB = aB / (aB + bB);
  const pAShifted = probBetaExceedsScaled(aB, bB, aA + 1, bA, 1); // P(Beta(aA+1,bA) > Beta(aB,bB))
  const pBShifted = probBetaExceedsScaled(aB + 1, bB, aA, bA, 1); // P(Beta(aA,bA) > Beta(aB+1,bB))
  return Math.max(0, meanA * pAShifted - meanB * pBShifted);
}

/** Always-valid sequential p-value via Normal mixture SPRT (Johari et al., 2017)
 *  on the two-proportion difference. Valid under continuous peeking at any stop time. */
export function sequentialAlwaysValidP(
  nA: number,
  cA: number,
  nB: number,
  cB: number,
): number {
  if (nA < 10 || nB < 10) return 1;
  const pA = cA / nA;
  const pB = cB / nB;
  const pooled = (cA + cB) / (nA + nB);
  if (pooled <= 0 || pooled >= 1) return 1;
  const variance = pooled * (1 - pooled) * (1 / nA + 1 / nB);
  if (variance <= 0) return 1;
  // Mixing variance tau^2 calibrated to realistic relative effects (~25% of baseline rate).
  const tauSq = Math.max(0.0004, Math.pow(0.25 * pooled, 2));
  const diff = pB - pA;
  const ratio = variance / (variance + tauSq);
  const lambda = Math.sqrt(ratio) * Math.exp((tauSq * diff * diff) / (2 * variance * (variance + tauSq)));
  if (!Number.isFinite(lambda) || lambda <= 0) return 1;
  return Math.min(1, 1 / lambda);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 on erf, absolute error < 1.5e-7). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

/** Always-valid sequential p-value for HARM — the one-sided mirror of `sequentialAlwaysValidP` (review item 25).
 *
 *  Null: B converts no worse than A (θ = pB − pA ≥ 0). The mixture over the harmful side only, θ < 0, of the
 *  likelihood ratios, with the same N(0, τ²) prior folded onto that side:
 *    Λ = 2 · Λ₂ · Φ(−zτ),  Λ₂ = √(V/(V+τ²)) · exp(τ²D²/(2V(V+τ²))),  zτ = Dτ/√(V(V+τ²)),  D = pB − pA, V = pooled variance.
 *  Under θ = 0 each ratio has mean 1, so Λ is a non-negative martingale and P(Λ ever ≥ 1/α) ≤ α however often it is looked
 *  at (Ville). B at or above A can never be harm: p = 1. */
export function sequentialHarmP(nA: number, cA: number, nB: number, cB: number): number {
  if (nA < 10 || nB < 10) return 1;
  const pA = cA / nA;
  const pB = cB / nB;
  const diff = pB - pA;
  if (diff >= 0) return 1;
  const pooled = (cA + cB) / (nA + nB);
  if (pooled <= 0 || pooled >= 1) return 1;
  const variance = pooled * (1 - pooled) * (1 / nA + 1 / nB);
  if (variance <= 0) return 1;
  // The same mixing variance as the winner's test: effects of ~25% of the baseline rate.
  const tauSq = Math.max(0.0004, Math.pow(0.25 * pooled, 2));
  const z = (diff * Math.sqrt(tauSq)) / Math.sqrt(variance * (variance + tauSq)); // negative here
  const lambda = 2 * Math.sqrt(variance / (variance + tauSq)) * Math.exp((z * z) / 2) * normalCdf(-z);
  if (!Number.isFinite(lambda) || lambda <= 0) return 1;
  return Math.min(1, 1 / lambda);
}

/** Pearson chi-square (df = 1) for Sample Ratio Mismatch against expected splitBps. */
export function computeSrmChi2(nA: number, nB: number, splitBps: number): number {
  const total = nA + nB;
  if (total === 0 || splitBps <= 0 || splitBps >= 10_000) return 0;
  const pB = splitBps / 10_000;
  const pA = 1 - pB;
  const expA = total * pA;
  const expB = total * pB;
  return ((nA - expA) ** 2) / expA + ((nB - expB) ** 2) / expB;
}

/** An experiment's own hard stop, in days since it started: the one «Seguir probando» moved it to (`maxEndAt`), never shorter
 *  than the global default. The evaluator, the metrics and the list all use THIS, not `MAX_DURATION_DAYS` alone. */
export function maxDurationDaysOf(e: {
  readonly startedAt: Date | null;
  readonly maxEndAt: Date | null;
}): number {
  if (!e.startedAt || !e.maxEndAt) return MAX_DURATION_DAYS;
  const days = (e.maxEndAt.getTime() - e.startedAt.getTime()) / 86_400_000;
  return Number.isFinite(days) ? Math.max(MAX_DURATION_DAYS, days) : MAX_DURATION_DAYS;
}

export interface EvaluateAbStatsInput {
  readonly viewsA: number;
  readonly conversionsA: number;
  readonly viewsB: number;
  readonly conversionsB: number;
  readonly splitBps: number;
  readonly durationHours: number;
  readonly maxDurationDays?: number;
}

/** The numbers of the Bayesian posterior, each computed on first use: a verdict that the cheap gates (sample, time,
 *  always-valid tests) already settle never pays for the quadratures. */
interface Posterior {
  probBBeatsA(): number;
  probHarm30(): number;
  expectedLossB(): number;
  expectedLossA(): number;
}

function lazyPosterior(nA: number, cA: number, nB: number, cB: number): Posterior {
  const aA = PRIOR_ALPHA + cA;
  const bA = PRIOR_BETA + (nA - cA);
  const aB = PRIOR_ALPHA + cB;
  const bB = PRIOR_BETA + (nB - cB);
  const memo = <T>(f: () => T): (() => T) => {
    let done = false;
    let value: T;
    return () => {
      if (!done) {
        value = f();
        done = true;
      }
      return value;
    };
  };
  return {
    probBBeatsA: memo(() => probBetaExceedsScaled(aA, bA, aB, bB, 1)),
    // P(pB < 0.70 * pA) = 1 - P(pB > 0.70 * pA)
    probHarm30: memo(() => 1 - probBetaExceedsScaled(aA, bA, aB, bB, HARM_DROP_RATIO)),
    expectedLossB: memo(() => expectedLossChooseB(aA, bA, aB, bB)),
    expectedLossA: memo(() => expectedLossChooseB(aB, bB, aA, bA)),
  };
}

interface Counts {
  readonly nA: number;
  readonly cA: number;
  readonly nB: number;
  readonly cB: number;
  readonly durationHours: number;
  readonly maxHours: number;
  readonly splitBps: number;
}

function countsOf(input: EvaluateAbStatsInput): Counts {
  const nA = Math.max(0, Math.floor(input.viewsA));
  const nB = Math.max(0, Math.floor(input.viewsB));
  return {
    nA,
    nB,
    cA: Math.min(nA, Math.max(0, Math.floor(input.conversionsA))),
    cB: Math.min(nB, Math.max(0, Math.floor(input.conversionsB))),
    durationHours: Math.max(0, input.durationHours),
    maxHours: (input.maxDurationDays ?? MAX_DURATION_DAYS) * 24,
    splitBps: input.splitBps,
  };
}

interface Decision {
  readonly verdict: AbVerdict;
  readonly winner: AbVariant | null;
  readonly reason?: AbInconclusiveReason;
}

/** THE VERDICT. Cheap gates first, the posterior only when they pass (and only the parts the decision reads), so a
 *  simulation can ask it every 30 minutes for three weeks (stats.test.ts does). Order: uneven traffic blocks everything;
 *  then the harm brake; then a winner. Both the brake and the winner need an ALWAYS-VALID test, because the evaluator
 *  looks every 30 minutes: a fixed-horizon p-value or a posterior threshold alone would fire on noise sooner or later. */
function decide(c: Counts, post: Posterior): Decision {
  const { nA, cA, nB, cB, durationHours, maxHours } = c;
  const srmWarning = nA + nB >= SRM_MIN_TOTAL_VIEWS && computeSrmChi2(nA, nB, c.splitBps) > SRM_CHI2_CRITICAL;

  if (srmWarning) {
    // No winner can be declared on a split that isn't the one asked for — but the experiment doesn't wait for ever: at the
    // end of ITS time it closes as «no result, uneven traffic», and the owner is told (review item 24).
    return durationHours >= maxHours
      ? { verdict: "inconclusive", winner: null, reason: "uneven_traffic" }
      : { verdict: "srm_blocked", winner: null };
  }

  if (
    nA >= HARM_MIN_VIEWS_PER_VARIANT &&
    nB >= HARM_MIN_VIEWS_PER_VARIANT &&
    durationHours >= HARM_MIN_DURATION_HOURS &&
    cA >= HARM_MIN_CONTROL_CONVERSIONS &&
    sequentialHarmP(nA, cA, nB, cB) <= HARM_MAX_ALWAYS_VALID_P &&
    post.probHarm30() >= HARM_PROBABILITY
  ) {
    return { verdict: "harm_stop", winner: "a" };
  }

  if (
    nA >= MIN_VIEWS_PER_VARIANT &&
    nB >= MIN_VIEWS_PER_VARIANT &&
    cA + cB >= MIN_TOTAL_CONVERSIONS &&
    durationHours >= MIN_DURATION_HOURS &&
    sequentialAlwaysValidP(nA, cA, nB, cB) <= MAX_ALWAYS_VALID_P
  ) {
    const absLift = Math.abs(relativeLiftOf(nA, cA, nB, cB));
    if (
      absLift >= MIN_RELATIVE_LIFT &&
      cB >= MIN_LEADER_CONVERSIONS &&
      post.probBBeatsA() >= WIN_PROBABILITY &&
      post.expectedLossB() <= MAX_EXPECTED_LOSS
    ) {
      return { verdict: "winner_b", winner: "b" };
    }
    if (
      absLift >= MIN_RELATIVE_LIFT &&
      cA >= MIN_LEADER_CONVERSIONS &&
      1 - post.probBBeatsA() >= WIN_PROBABILITY &&
      post.expectedLossA() <= MAX_EXPECTED_LOSS
    ) {
      return { verdict: "winner_a", winner: "a" };
    }
  }
  if (durationHours >= maxHours) return { verdict: "inconclusive", winner: null };
  return { verdict: "collecting", winner: null };
}

function relativeLiftOf(nA: number, cA: number, nB: number, cB: number): number {
  const rateA = nA > 0 ? cA / nA : 0;
  const rateB = nB > 0 ? cB / nB : 0;
  if (rateA > 0) return (rateB - rateA) / rateA;
  const meanA = (PRIOR_ALPHA + cA) / (PRIOR_ALPHA + PRIOR_BETA + nA);
  const meanB = (PRIOR_ALPHA + cB) / (PRIOR_ALPHA + PRIOR_BETA + nB);
  return meanA > 0 ? (meanB - meanA) / meanA : 0;
}

/** Only the verdict — what the evaluator's decision comes down to — without computing the numbers the card shows. For
 *  simulations of the evaluator's cadence. `evaluateAbStats(x).verdict` is always the same as `evaluateAbVerdict(x).verdict`. */
export function evaluateAbVerdict(input: EvaluateAbStatsInput): Decision {
  const c = countsOf(input);
  return decide(c, lazyPosterior(c.nA, c.cA, c.nB, c.cB));
}

export function evaluateAbStats(input: EvaluateAbStatsInput): AbStatsResult {
  const c = countsOf(input);
  const { nA, cA, nB, cB, durationHours } = c;
  const post = lazyPosterior(nA, cA, nB, cB);
  const decision = decide(c, post);

  const aA = PRIOR_ALPHA + cA;
  const bA = PRIOR_BETA + (nA - cA);
  const aB = PRIOR_ALPHA + cB;
  const bB = PRIOR_BETA + (nB - cB);

  const probBBeatsA = post.probBBeatsA();
  const probABeatsB = 1 - probBBeatsA;
  const alwaysValidP = sequentialAlwaysValidP(nA, cA, nB, cB);
  const harmAlwaysValidP = sequentialHarmP(nA, cA, nB, cB);

  const srmChi2 = computeSrmChi2(nA, nB, c.splitBps);
  const srmWarning = nA + nB >= SRM_MIN_TOTAL_VIEWS && srmChi2 > SRM_CHI2_CRITICAL;

  const meanA = aA / (aA + bA);
  const meanB = aB / (aB + bB);
  const relativeLift = relativeLiftOf(nA, cA, nB, cB);

  // Delta-method 95% credible interval for relative lift (pB - pA) / pA using posterior moments.
  const varA = (aA * bA) / ((aA + bA) ** 2 * (aA + bA + 1));
  const varB = (aB * bB) / ((aB + bB) ** 2 * (aB + bB + 1));
  const ratioMean = meanB / meanA;
  const ratioSd = Math.sqrt(varB / (meanA * meanA) + (meanB * meanB * varA) / (meanA ** 4));
  const liftCiLow = ratioMean - 1 - 1.96 * ratioSd;
  const liftCiHigh = ratioMean - 1 + 1.96 * ratioSd;

  return {
    verdict: decision.verdict,
    winner: decision.winner,
    probBBeatsA,
    probABeatsB,
    probHarm30: post.probHarm30(),
    expectedLossB: post.expectedLossB(),
    expectedLossA: post.expectedLossA(),
    relativeLift,
    liftCiLow,
    liftCiHigh,
    alwaysValidP,
    harmAlwaysValidP,
    srmChi2,
    srmWarning,
    durationHours,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };
}
