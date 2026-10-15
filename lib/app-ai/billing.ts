// lib/app-ai/billing.ts — WHAT A CALL COSTS, in centicredits (spec local
// 2026-10-15, 4.4), always through `creditsForUsage`, the one place where
// Len's turns are charged too: same rate, same rounding.
//   · the WORST case is reserved before calling: the input estimated on the
//     high side plus all of `max_tokens`, with no cache discount;
//   · the REAL cost is charged with the usage the provider reports;
//   · when that never comes (the client cut the stream), what was streamed.

import { creditsForUsage, type CreditRate } from "@/lib/credits";

/** Bytes (or characters) → tokens, on the high side: three per token. */
export function estimateTokens(bytesOrChars: number): number {
  return Math.ceil(Math.max(0, bytesOrChars) / 3);
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
}

export function worstCaseCenticredits(o: { readonly inputBytes: number; readonly maxTokens: number; readonly rate: CreditRate }): number {
  return creditsForUsage(estimateTokens(o.inputBytes), o.maxTokens, o.rate);
}

export function actualCenticredits(u: Usage, rate: CreditRate): number {
  return creditsForUsage(u.inputTokens, u.outputTokens, rate, u.cachedTokens);
}

export function streamedCenticredits(o: { readonly inputBytes: number; readonly outputChars: number; readonly rate: CreditRate }): number {
  return creditsForUsage(estimateTokens(o.inputBytes), estimateTokens(o.outputChars), o.rate);
}
