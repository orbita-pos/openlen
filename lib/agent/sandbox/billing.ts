// What the real terminal's box costs the user (spec local 2026-10-21-real-terminal-e2b, §8):
// the same credits as everything else, per second the box runs, at E2B's list price, charged to
// the owner. A credit is $0.01 and a centicredit $0.0001, so a minute is 28 centicredits.

import { chargeCredits } from "@/lib/credits";

import { SANDBOX_MODEL, SANDBOX_USD_PER_SECOND } from "./size";

export {
  E2B_USD_PER_GIB_SECOND,
  E2B_USD_PER_VCPU_SECOND,
  SANDBOX_MEMORY_GIB,
  SANDBOX_MODEL,
  SANDBOX_USD_PER_SECOND,
  SANDBOX_VCPU,
} from "./size";

const USD_PER_CENTICREDIT = 0.0001;

/** Centicredits for `seconds` of box, rounded up: a box that ran is never free. */
export function sandboxCenticredits(seconds: number): number {
  if (!(seconds > 0)) return 0;
  // Rounded to a micro-dollar first, so floating point (60 × 0.000046 = 0.0027600000000000003) doesn't round a whole centicredit up.
  const microUsd = Math.round(seconds * SANDBOX_USD_PER_SECOND * 1_000_000);
  return Math.ceil(microUsd / (USD_PER_CENTICREDIT * 1_000_000));
}

/** Charges the owner for the turn's box time; returns the centicredits that really moved. */
export async function chargeSandbox(o: {
  readonly userId: string;
  readonly actorId?: string | null;
  readonly projectId: string;
  readonly turnId: string;
  readonly seconds: number;
}): Promise<number> {
  const centicredits = sandboxCenticredits(o.seconds);
  if (centicredits === 0) return 0;
  return chargeCredits(o.userId, centicredits, {
    surface: "sandbox",
    outcome: "ok",
    projectId: o.projectId,
    actorId: o.actorId ?? null,
    refId: o.turnId,
    uses: [{ provider: "e2b", model: SANDBOX_MODEL, seconds: o.seconds }],
  });
}
