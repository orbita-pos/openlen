/**
 * The money guard of the paid Len 3.0 trial (scripts/artifact-trial.ts). Test
 * glue, never imported by the product. It counts what the trial has spent —
 * Len's recorded turns plus every provider attempt — and lets a new paid call
 * start only if its worst case still fits under the approved cap.
 *
 * An attempt whose cost is unknown (the speech API reports none) or not settled
 * yet counts at its worst case: a guard that guessed low would let the cap slip.
 */
export type PaidKind = "image" | "audio";

export interface TrialLimits {
  readonly capUsd: number;
  /** The most one call of each kind can cost (generous on purpose). */
  readonly worstCaseUsd: Readonly<Record<PaidKind, number>>;
  /** A hard count per kind, whatever the money says. */
  readonly maxCalls: Readonly<Record<PaidKind, number>>;
}

export interface TrialAttempt {
  readonly kind: PaidKind;
  /** From the attempt's receipt; null when unknown or not recorded yet. */
  readonly costMicroUsd: number | null;
}

const KINDS: readonly PaidKind[] = ["image", "audio"];

/** The trial only ever runs on a LOCAL throwaway database; returns its name or throws. */
export function requireTrialDatabase(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("DATABASE_URL is not a URL"); }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error(`the trial needs a local database, not ${parsed.hostname}`);
  if (!/^openlen_(codex_test|trial)_[a-z0-9_]+$/.test(name)) throw new Error(`"${name}" is not a throwaway trial database (openlen_trial_* or openlen_codex_test_*)`);
  return name;
}

export function trialSpend(lenUsd: number, attempts: readonly TrialAttempt[], limits: TrialLimits): number {
  return attempts.reduce((total, a) => total + (a.costMicroUsd === null ? limits.worstCaseUsd[a.kind] : a.costMicroUsd / 1_000_000), lenUsd);
}

export function trialAllows(kind: PaidKind, lenUsd: number, attempts: readonly TrialAttempt[], limits: TrialLimits): { ok: true } | { ok: false; reason: string } {
  if (!KINDS.includes(kind)) return { ok: false, reason: `no price for a paid "${String(kind)}" call` };
  const calls = attempts.filter((a) => a.kind === kind).length;
  if (calls >= limits.maxCalls[kind]) return { ok: false, reason: `${kind}: ${calls} calls already, the limit is ${limits.maxCalls[kind]}` };
  const projected = trialSpend(lenUsd, attempts, limits) + limits.worstCaseUsd[kind];
  if (projected > limits.capUsd) return { ok: false, reason: `${kind}: $${projected.toFixed(3)} with this call would pass the $${limits.capUsd} cap` };
  return { ok: true };
}
