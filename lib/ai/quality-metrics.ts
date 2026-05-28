// In-memory quality metrics for the vision critic (Quality S3).
//
// Process-local counters, no DB — enough to tell us whether the regen
// threshold is calibrated once we have ~100 generations. Reset on restart;
// under multiple Next workers each keeps its own counters. That's fine: this
// is a calibration signal, not billing. If we ever want to mine verdicts for
// prompt tuning we'll add a table then (not speculatively now).

export interface QualityMetricsSnapshot {
  /** Generations that reached the critic stage (critic enabled + valid first
   *  pass). Includes runs where the critic fell back. */
  totalGens: number;
  /** Verdicts where shouldRegenerate was true (a regen fired). */
  regensTriggered: number;
  /** Regens that produced a valid page that shipped (vs fell back to the
   *  first pass). */
  regensSucceeded: number;
  /** Critic runs that returned the no-critique fallback (timeout / render
   *  miss / malformed verdict / API error). Surfaced so a high fallback rate
   *  doesn't masquerade as a healthy low regen rate. */
  criticFallbacks: number;
  /** regensTriggered / totalGens. Null until at least one gen is recorded. */
  regenRate: number | null;
}

interface Counters {
  totalGens: number;
  regensTriggered: number;
  regensSucceeded: number;
  criticFallbacks: number;
}

const counters: Counters = {
  totalGens: 0,
  regensTriggered: 0,
  regensSucceeded: 0,
  criticFallbacks: 0,
};

/** Record one completed critic evaluation. */
export function recordCriticRun(opts: {
  shouldRegenerate: boolean;
  fallback: boolean;
}): void {
  counters.totalGens += 1;
  if (opts.fallback) counters.criticFallbacks += 1;
  if (opts.shouldRegenerate) counters.regensTriggered += 1;
}

/** Record the outcome of a regen that fired — `succeeded` = a valid regen
 *  page shipped (false = fell back to the first pass). */
export function recordRegenOutcome(succeeded: boolean): void {
  if (succeeded) counters.regensSucceeded += 1;
}

export function getQualityMetrics(): QualityMetricsSnapshot {
  return {
    totalGens: counters.totalGens,
    regensTriggered: counters.regensTriggered,
    regensSucceeded: counters.regensSucceeded,
    criticFallbacks: counters.criticFallbacks,
    regenRate:
      counters.totalGens > 0
        ? counters.regensTriggered / counters.totalGens
        : null,
  };
}

/** Test-only reset. */
export function __resetQualityMetrics(): void {
  counters.totalGens = 0;
  counters.regensTriggered = 0;
  counters.regensSucceeded = 0;
  counters.criticFallbacks = 0;
}
