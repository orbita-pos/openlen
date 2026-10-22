// lib/stripe/twins/discover.ts — THE TEST-MODE STRIPE REFS IN WHAT IS PUBLISHED
// (spec local 2026-10-21-stripe-integration, §6.4): ids of products, prices,
// payment links, shipping rates and portal configurations, and test payment
// links (`https://buy.stripe.com/test_…`). Stripe's generated ids are long; a
// short look-alike (`price_x`) is not one.

import type { StripeObjectKind } from "../store";

const ID = /\b(?:prod|price|plink|shr|bpc)_[A-Za-z0-9]{14,}\b/g;
const TEST_LINK = /https:\/\/buy\.stripe\.com\/test_[A-Za-z0-9]+/g;

export function findStripeRefs(texts: readonly string[]): { readonly ids: ReadonlySet<string>; readonly links: ReadonlySet<string> } {
  const ids = new Set<string>();
  const links = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(ID)) ids.add(m[0]);
    for (const m of t.matchAll(TEST_LINK)) links.add(m[0]);
  }
  return { ids, links };
}

const KINDS: readonly [string, StripeObjectKind][] = [
  ["prod_", "product"],
  ["price_", "price"],
  ["plink_", "payment_link"],
  ["shr_", "shipping_rate"],
  ["bpc_", "portal_configuration"],
  ["we_", "webhook_endpoint"],
];

export function kindOfId(id: string): StripeObjectKind | null {
  return KINDS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? null;
}
