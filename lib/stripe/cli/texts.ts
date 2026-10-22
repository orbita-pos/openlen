// lib/stripe/cli/texts.ts — WHAT LEN READS FROM THE `stripe` COMMAND when it isn't
// Stripe's own answer (spec local 2026-10-21-stripe-integration, §6.2). Each
// one says why and what to do instead.

import type { StripeEnv } from "../api";

export const LIVE_WRITE_REFUSAL =
  "Len doesn't write in live mode. Publishing copies the products, prices, payment links, shipping rates, portal configurations and webhook endpoints the project uses to live mode. What only the owner can do there (refunds, cancelling subscriptions) is done in the Stripe dashboard: https://dashboard.stripe.com/\n";

export const CREDENTIALS_ANSWER =
  "The Stripe key is the project's: ask the user for it with request_secrets, name STRIPE_SECRET_KEY. stripe login isn't needed here.\n";

export function noKeyText(env: StripeEnv): string {
  return env === "draft"
    ? "No Stripe key for the draft yet: ask the user for it with request_secrets, name STRIPE_SECRET_KEY (a test key).\n"
    : "No Stripe key for production yet: the owner adds it when publishing.\n";
}

export function listenText(endpoints: readonly { readonly url: string; readonly events: readonly string[] }[], draftFunctionsUrl: string | null): string {
  const head = "No need to forward: Stripe sends test-mode events straight to the draft's Edge Functions.";
  if (endpoints.length === 0) {
    const url = draftFunctionsUrl ? `${draftFunctionsUrl}<function>` : "<the draft's function URL>";
    return `${head} No webhook endpoint is registered in test mode yet: register one with stripe webhook_endpoints create --url=${url} --enabled-events=<event>\n`;
  }
  return `${head} Webhook endpoints registered in test mode:\n${endpoints.map((e) => `${e.url} (${e.events.join(", ")})`).join("\n")}\n`;
}
