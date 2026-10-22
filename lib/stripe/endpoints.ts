// lib/stripe/endpoints.ts — THE WEBHOOK ENDPOINTS GO WITH THE KEY (spec local
// 2026-10-21-stripe-integration, §6.3 and §6.7). When a Stripe key is removed,
// the endpoints registered with it are deleted in Stripe (best effort: Stripe
// disables one on its own after failed deliveries), and their secrets go too.
// The draft forgets its test endpoints; the published site clears their twins.
// Product, price and link twins stay, in case the same account comes back.

import { stripeRequest, type StripeEnv, type StripeFetch } from "./api";
import type { StripeStore } from "./store";

export interface EndpointsDeps {
  readonly store: StripeStore;
  /** The STRIPE_SECRET_KEY of that environment, before it is removed. */
  keyFor(env: StripeEnv): Promise<string | null>;
  readonly f?: StripeFetch;
}

export async function deleteProjectEndpoints(projectId: string, env: StripeEnv, d: EndpointsDeps): Promise<string[]> {
  const rows = (await d.store.listObjects(projectId)).filter((r) => r.kind === "webhook_endpoint" && (env === "draft" || r.liveId));
  const key = await d.keyFor(env);
  const names: string[] = [];
  for (const r of rows) {
    const id = env === "draft" ? r.testId : r.liveId!;
    if (key) {
      await stripeRequest(key, { method: "DELETE", path: `/v1/webhook_endpoints/${encodeURIComponent(id)}` }, d.f).catch((err: unknown) =>
        console.warn("[stripe] could not delete webhook endpoint", projectId, id, err),
      );
    }
    if (env === "draft") await d.store.forgetTestObject(projectId, r.testId);
    else await d.store.clearTwin(projectId, r.testId);
    if (r.secretName && !names.includes(r.secretName)) names.push(r.secretName);
  }
  return names;
}
