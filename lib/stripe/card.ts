// lib/stripe/card.ts — WHAT LEN'S PUBLISH CARD SHOWS OF STRIPE (spec local
// 2026-10-21-stripe-integration, §6.4): what will be copied to live mode, how
// many test refs the published site will carry live, whether the account can
// charge, and refs that exist nowhere. The card's reader
// (components/llamada/puente-a-len.ts) copies the `confirm` field by field: this
// is the field's shape, checked, so a malformed one never reaches the card.
// Client-safe: types only from the engine.

import type { TwinsPlanCounts } from "./twins/engine";

export interface StripeForCard {
  readonly create: TwinsPlanCounts;
  readonly swaps: number;
  readonly chargesEnabled: boolean | null;
  readonly unknownRefs: readonly string[];
}

const COUNT_KEYS: readonly (keyof TwinsPlanCounts)[] = ["products", "prices", "paymentLinks", "shippingRates", "portalConfigurations", "webhookEndpoints"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function stripeForCard(v: unknown): StripeForCard | null {
  if (!isObj(v) || !isObj(v.create) || typeof v.swaps !== "number") return null;
  const create = v.create;
  if (!COUNT_KEYS.every((k) => typeof create[k] === "number")) return null;
  return {
    create: Object.fromEntries(COUNT_KEYS.map((k) => [k, create[k] as number])) as unknown as TwinsPlanCounts,
    swaps: v.swaps,
    chargesEnabled: typeof v.chargesEnabled === "boolean" ? v.chargesEnabled : null,
    unknownRefs: Array.isArray(v.unknownRefs) ? v.unknownRefs.filter((x): x is string => typeof x === "string") : [],
  };
}

/** The kinds with something to copy, in a fixed order, for the card's sentence. */
export function stripeKindsToCopy(s: Pick<StripeForCard, "create">): [keyof TwinsPlanCounts, number][] {
  return COUNT_KEYS.filter((k) => s.create[k] > 0).map((k) => [k, s.create[k]]);
}
