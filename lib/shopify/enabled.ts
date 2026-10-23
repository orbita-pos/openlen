// lib/shopify/enabled.ts — THE SWITCH (spec local 2026-10-22-shopify-storefront, §6.9):
// on by default, since it needs no key and costs OpenLen nothing; `OPENLEN_SHOPIFY=0`
// turns it all off. What is already published keeps working: it talks to Shopify itself.

export function shopifyEnabledIn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_SHOPIFY?.trim() !== "0";
}
