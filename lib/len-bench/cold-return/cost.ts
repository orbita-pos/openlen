// WHAT A RUN COSTS (spec local 2026-11-13-conversar-todo-el-mes, §8.2), from the calls the route recorded
// (`agentRequestSteps`, one row per call to the provider). Two figures, never mixed:
//
//   · `costUsd` — what the run would cost in PRODUCTION, which is what the arms are compared by. The cold
//     return's first call is priced as if nothing was cached: in the bench the same case runs again and
//     again, and the provider may well still have it — a discount nobody coming back after ten hours gets.
//     The summary, where there is one, is priced as read from the cache: in production it is written while
//     the conversation is still warm.
//   · `spentUsd` — what the run really cost here, as the provider reported it. The budget's cap counts this.
//
// Both at DeepInfra's list price without its promotion, as everywhere in the spec's §8.
import { PROBE_LIST_PRICE } from "@/lib/measure/cache-probe";

/** USD per million tokens. One truth with the cache probe's. */
export const LIST_PRICE = PROBE_LIST_PRICE;

export interface TokenUsage {
  readonly inputTokens: number;
  /** A subset of `inputTokens`. */
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

/** One call to the provider. */
export interface CallUsage extends TokenUsage {
  /** Which of the run's three questions it belongs to, 0-based. */
  readonly question: number;
  /** Its place in the turn, as the route numbered it. */
  readonly step: number;
}

export function usdOf(usage: TokenUsage, price = LIST_PRICE): number {
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  return ((usage.inputTokens - cached) * price.input + cached * price.cached + usage.outputTokens * price.output) / 1e6;
}

export interface RunCost {
  readonly costUsd: number;
  readonly spentUsd: number;
  /** Input tokens of the cold return's first call. */
  readonly firstCallTokens: number;
}

export function runCost(calls: readonly CallUsage[], summary?: TokenUsage | null): RunCost {
  const first = [...calls].sort((a, b) => a.question - b.question || a.step - b.step)[0];
  let costUsd = 0;
  let spentUsd = 0;
  for (const call of calls) {
    spentUsd += usdOf(call);
    costUsd += usdOf(call === first ? { ...call, cachedTokens: 0 } : call);
  }
  if (summary) {
    spentUsd += usdOf(summary);
    costUsd += usdOf({ ...summary, cachedTokens: summary.inputTokens });
  }
  return { costUsd, spentUsd, firstCallTokens: first?.inputTokens ?? 0 };
}
