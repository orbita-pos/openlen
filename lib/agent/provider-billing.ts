/**
 * WHAT THE ROUTE DOES WITH A TURN'S PROVIDERS (spec local
 * docs/superpowers/specs/2026-10-16-second-provider-design.md §3.4–3.4b).
 *
 * Pure, so the route and its tests share the arithmetic.
 */
import type { ProviderId } from "@/lib/ai/providers";
import type { UsageTotals } from "./brain";
import type { TranscripcionGuardada } from "./transcripcion";

/** A conversation sticks to the provider of its last turn only while that
 *  provider's cache is still warm. After this, either cache is a guess, and the
 *  turn goes back to the primary. */
export const PROVIDER_STICKY_MS = 600_000;

export function preferredProviderFrom(t: TranscripcionGuardada | null | undefined, now: number): ProviderId | null {
  const served = t?.provider;
  if (!served) return null;
  const at = Date.parse(served.at);
  if (!Number.isFinite(at)) return null;
  return now - at < PROVIDER_STICKY_MS ? served.id : null;
}

/** The brain's `minus` plus what the loop estimated for failed attempts that
 *  sent no usage (`AgentLoopResult.forgivenUsage`): together, everything that
 *  failed on the provider OpenLen left. */
export function withForgiven(minus: UsageTotals, estimated?: UsageTotals): UsageTotals {
  if (!estimated) return minus;
  return {
    inputTokens: minus.inputTokens + estimated.inputTokens,
    outputTokens: minus.outputTokens + estimated.outputTokens,
    cachedTokens: minus.cachedTokens + estimated.cachedTokens,
    thinkingTokens: minus.thinkingTokens + estimated.thinkingTokens,
  };
}

/** What the user is charged for: the real usage minus what failed on the
 *  provider OpenLen left, with the fallback's first re-read billed as cached. */
export function billedUsage(real: UsageTotals, adj: { minus: UsageTotals; extraCached: number }): UsageTotals {
  const inputTokens = Math.max(0, real.inputTokens - adj.minus.inputTokens);
  const cached = Math.max(0, real.cachedTokens - adj.minus.cachedTokens) + Math.max(0, adj.extraCached);
  return {
    inputTokens,
    outputTokens: Math.max(0, real.outputTokens - adj.minus.outputTokens),
    cachedTokens: Math.min(inputTokens, cached),
    thinkingTokens: Math.max(0, real.thinkingTokens - adj.minus.thinkingTokens),
  };
}
