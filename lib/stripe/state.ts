// lib/stripe/state.ts — WHAT LEN KNOWS OF THE PROJECT'S STRIPE every turn (spec
// local 2026-10-21-stripe-integration, §6.8), in PROJECT STATE beside the Edge
// Functions: the account behind each environment's key and the webhook
// endpoints registered in test mode. From OpenLen's tables, never from Stripe,
// and never a value.

import type { StripeStore } from "./store";

export interface StripeStateForLen {
  readonly draft: { readonly account_id: string; readonly account_name: string | null; readonly key: "restricted" | "secret" } | null;
  readonly production: {
    readonly account_id: string;
    readonly account_name: string | null;
    readonly key: "restricted" | "secret";
    readonly charges_enabled: boolean | null;
  } | null;
  readonly webhook_endpoints: readonly { readonly url: string; readonly function: string | null; readonly secret: string | null }[];
}

const keyWord = (k: "sk" | "rk") => (k === "rk" ? ("restricted" as const) : ("secret" as const));

export async function stripeStateFor(projectId: string, store?: StripeStore): Promise<StripeStateForLen | null> {
  const s = store ?? (await import("./store-pg")).pgStripeStore;
  const [draft, live, objects] = await Promise.all([s.getAccount(projectId, "draft"), s.getAccount(projectId, "live"), s.listObjects(projectId)]);
  const endpoints = objects.filter((o) => o.kind === "webhook_endpoint");
  if (!draft && !live && endpoints.length === 0) return null;
  return {
    draft: draft ? { account_id: draft.accountId, account_name: draft.accountName, key: keyWord(draft.keyKind) } : null,
    production: live ? { account_id: live.accountId, account_name: live.accountName, key: keyWord(live.keyKind), charges_enabled: live.chargesEnabled } : null,
    webhook_endpoints: endpoints.map((e) => ({ url: e.testUrl ?? "", function: e.functionName, secret: e.secretName })),
  };
}
