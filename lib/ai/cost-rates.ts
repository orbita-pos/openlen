/**
 * WHAT OPENLEN PAYS — the COST rate, kept apart from the BILLING rate.
 *
 * `lib/ai/tarifas.ts` is what a user is charged in credits (Fireworks' list
 * price). This file is what OpenLen actually pays each provider, per model and,
 * where the provider has one, per time band. Today the only text provider is
 * Fireworks at list price, so both say the same thing and the measured margin is
 * today's; a second provider only adds its row here, and users keep paying the
 * billing rate (spec local docs/superpowers/specs/2026-10-16-credit-ledger-design.md).
 *
 * Pure on purpose, like `tarifas.ts`: the ledger, the reports and the tests read
 * it without pulling the database in. Its one import, the real terminal's box
 * size and price, is import-free too.
 *
 * Every value is USD; token prices are per million tokens. An unknown model or
 * unit is `null`, never 0 — a cost of 0 would read as "free".
 */

import { SANDBOX_MODEL, SANDBOX_USD_PER_SECOND } from "@/lib/agent/sandbox/size";

export type CostProvider = "fireworks" | "deepinfra" | "openai" | "exa" | "e2b";

export interface TokenPrices {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

export interface TokenCostRate extends TokenPrices {
  /** A peak band, like DeepSeek's (and OpenCode's `costPeak`): these prices
   *  apply at the listed UTC hours on the listed ISO weekdays (Monday = 1,
   *  Sunday = 7). Absent = one price all day. */
  readonly peak?: TokenPrices & { readonly hoursUtc: readonly number[]; readonly isoDays: readonly number[] };
}

/** Keyed by `${provider}/${model}`, with the model id the provider is called with. */
export const TOKEN_COST_RATES: Readonly<Record<string, TokenCostRate>> = {
  // docs.fireworks.ai/serverless/pricing, Standard column, read 2026-10-16:
  // the same list price the billing rate uses (`V4P1_FLASH` in tarifas.ts).
  "fireworks/accounts/fireworks/models/deepseek-v4p1-flash": { input: 0.3, cached: 0.006, output: 1.2 },
  // fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash-1017, read 2026-10-21:
  // the same list price. Keep the previous id for historical usage.
  "fireworks/accounts/fireworks/models/deepseek-v4p1-flash-1017": { input: 0.3, cached: 0.006, output: 1.2 },
  // deepinfra.com/deepseek-ai/DeepSeek-V4.1-Flash, read 2026-10-16: the price
  // paid TODAY, a 30 % promotion with no end date. Without it, 0.20 / 0.006 /
  // 0.60 — change this row the day the promotion ends.
  "deepinfra/deepseek-ai/DeepSeek-V4.1-Flash": { input: 0.14, cached: 0.004, output: 0.42 },
  // deepinfra.com/deepseek-ai/DeepSeek-V4.1-Flash-1017, read 2026-10-17:
  // Standard, 51 % promotion; cached price rounded as displayed. Without the
  // promotion, 0.20 / 0.006 / 0.60. Keep the previous id for historical usage.
  "deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017": { input: 0.098, cached: 0.003, output: 0.294 },
};

export const UNIT_COSTS_USD = {
  /** Per edited image. gpt-image-2 at `medium`, 1024²: OpenAI's per-image table
   *  says $0.053 and the token-derived figure $0.032; like
   *  `AI_IMAGE_EDIT_CREDIT_COST`, the higher one. */
  imageEdit: { "openai/gpt-image-2": 0.053 } as Readonly<Record<string, number>>,
  /** Per minute of voice (lib/voz/billing.ts, measured 2026-09-30). */
  voiceMinute: { "openai/gpt-live-1": 0.05 } as Readonly<Record<string, number>>,
  /** Per search: Exa "Auto" $7/1 000 plus ~8 result snippets as Contents at
   *  $1/1 000 pages (exa.ai/pricing, read 2026-10-02; lib/agent/web/buscar.ts). */
  webSearchQuery: { "exa/search": 0.015 } as Readonly<Record<string, number>>,
  /** Per second of the real terminal's box running (lib/agent/sandbox/size.ts). */
  sandboxSecond: { [`e2b/${SANDBOX_MODEL}`]: SANDBOX_USD_PER_SECOND } as Readonly<Record<string, number>>,
} as const;

/** Direct Images API, Standard (not Batch/Flex). Official pricing.md read
 * 2026-10-18: gpt-image-2 input text $5/M, image $8/M, output image $30/M.
 * https://developers.openai.com/api/docs/pricing
 * Cached-input prices do not apply to direct Images calls. Keep legacy
 * imageEdit's established flat accounting separate. Incomplete usage is null.
 */
export function imageGenerationCostMicroUsd(model:string,usage:Readonly<Record<string,unknown>>|null):number|null {
  if(model!=="gpt-image-2"||!usage)return null;
  const details=usage.input_tokens_details as Record<string,unknown>|undefined;
  const outputDetails=usage.output_tokens_details as Record<string,unknown>|undefined;
  const text=details?.text_tokens,image=details?.image_tokens,output=usage.output_tokens,total=usage.input_tokens;
  if(![text,image,output,total].every(n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0)
    ||Number(text)+Number(image)!==total|| (outputDetails?.text_tokens!==undefined&&outputDetails.text_tokens!==0)
    ||(outputDetails?.image_tokens!==undefined&&outputDetails.image_tokens!==output))return null;
  return Math.round(Number(text)*5+Number(image)*8+Number(output)*30);
}

/** The prices in force at `at`. */
export function peakAwareRate(rate: TokenCostRate, at: Date): TokenPrices {
  const peak = rate.peak;
  if (peak) {
    const isoDay = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
    if (peak.isoDays.includes(isoDay) && peak.hoursUtc.includes(at.getUTCHours())) {
      return { input: peak.input, cached: peak.cached, output: peak.output };
    }
  }
  return { input: rate.input, cached: rate.cached, output: rate.output };
}

/** Cached tokens are a SUBSET of the input. An impossible count (negative,
 *  NaN, more than the input) must not become a discount — the same guard as
 *  `clampCached` in lib/credits.ts. */
function clampCached(cached: number, input: number): number {
  if (!Number.isFinite(cached) || cached <= 0) return 0;
  return Math.min(Math.floor(cached), Math.max(0, input));
}

/** What a model call cost OpenLen, in micro-USD; `null` if the model has no cost rate. */
export function tokenCostMicroUsd(u: {
  provider: CostProvider;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  at: Date;
}): number | null {
  const rate = TOKEN_COST_RATES[`${u.provider}/${u.model}`];
  if (!rate) return null;
  const prices = peakAwareRate(rate, u.at);
  const input = Math.max(0, u.inputTokens);
  const cached = clampCached(u.cachedTokens, input);
  const output = Math.max(0, u.outputTokens);
  // USD per million tokens × tokens = micro-USD.
  return Math.round((input - cached) * prices.input + cached * prices.cached + output * prices.output);
}

/** What a unit-priced use cost OpenLen, in micro-USD; `null` if its price is unknown
 *  or it names no unit. */
export function unitCostMicroUsd(u: {
  provider: CostProvider;
  model: string;
  images?: number;
  seconds?: number;
  queries?: number;
}): number | null {
  const key = `${u.provider}/${u.model}`;
  if (u.images !== undefined) {
    const usd = UNIT_COSTS_USD.imageEdit[key];
    return usd === undefined ? null : Math.round(u.images * usd * 1_000_000);
  }
  if (u.seconds !== undefined) {
    const perSecond = UNIT_COSTS_USD.sandboxSecond[key];
    if (perSecond !== undefined) return Math.round(u.seconds * perSecond * 1_000_000);
    const usd = UNIT_COSTS_USD.voiceMinute[key];
    return usd === undefined ? null : Math.round((u.seconds / 60) * usd * 1_000_000);
  }
  if (u.queries !== undefined) {
    const usd = UNIT_COSTS_USD.webSearchQuery[key];
    return usd === undefined ? null : Math.round(u.queries * usd * 1_000_000);
  }
  return null;
}
