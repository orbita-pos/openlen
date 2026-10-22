// lib/stripe/enabled.ts — WHETHER THIS SERVER HAS STRIPE (spec local
// 2026-10-21-stripe-integration, §6.10). Stripe lives on top of the Edge
// Functions: without their engine there is no Stripe either, and
// OPENLEN_STRIPE=0 turns it off on its own. Pure: the manual reads it per server.

import { functionsEnabledIn } from "@/lib/functions/enabled";

export function stripeEnabledIn(env: Readonly<Record<string, string | undefined>>): boolean {
  return functionsEnabledIn(env) && env.OPENLEN_STRIPE !== "0";
}

export function stripeEnabled(): boolean {
  return stripeEnabledIn(process.env);
}
