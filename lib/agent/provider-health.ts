/**
 * WHICH PROVIDER TO SKIP FOR A WHILE (spec local docs/superpowers/specs/2026-10-16-second-provider-design.md §3.4).
 *
 * In memory, per process: a restart forgets it, on purpose — it only saves the
 * turns of the next few minutes from paying a broken provider's retries first.
 *
 *  - 3 turns IN A ROW that had to fall back from a provider → skip it 5 min;
 *  - a 402 (no balance) cools it at once (`coolDown`, called by the brain).
 */
import type { ProviderId } from "@/lib/ai/providers";

export const FALLBACK_TURNS_TO_COOL = 3;
export const COOL_MS = 300_000;

const coolingUntil = new Map<ProviderId, number>();
const fallbackStreak = new Map<ProviderId, number>();

export function isCooling(id: ProviderId, now: number): boolean {
  const until = coolingUntil.get(id);
  return until !== undefined && now < until;
}

/** Starts a cooling. `true` only when a NEW one started — so whoever logs it
 *  logs once per cooling, not once per turn that hit it. An ongoing cooling is
 *  not stretched. */
export function coolDown(id: ProviderId, now: number): boolean {
  if (isCooling(id, now)) return false;
  coolingUntil.set(id, now + COOL_MS);
  fallbackStreak.set(id, 0);
  return true;
}

/** Called once per turn, at its close, with the provider the turn STARTED on. */
export function noteTurn(o: { primary: ProviderId; fellBack: boolean; now: number }): void {
  if (!o.fellBack) {
    fallbackStreak.set(o.primary, 0);
    return;
  }
  const streak = (fallbackStreak.get(o.primary) ?? 0) + 1;
  fallbackStreak.set(o.primary, streak);
  if (streak >= FALLBACK_TURNS_TO_COOL) coolDown(o.primary, o.now);
}

/** Only for tests: the health is module state. */
export function _resetProviderHealth(): void {
  coolingUntil.clear();
  fallbackStreak.clear();
}
