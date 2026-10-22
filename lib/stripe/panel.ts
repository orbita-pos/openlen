// lib/stripe/panel.ts — THE PAYMENTS TAB (spec local 2026-10-21-stripe-integration,
// §6.6): the latest payments, active subscriptions, products with their prices
// and the webhook endpoints of one environment, read from Stripe at that moment
// with that environment's key (OpenLen keeps no copy of the payments), each with
// its link to Stripe's dashboard. Read-only: refunds and the rest are done there.

import type { SecretStore } from "@/lib/functions/secret-store";

import { stripeRequest, type StripeEnv, type StripeFetch } from "./api";
import type { StripeStore } from "./store";

export interface StripePanel {
  readonly available: true;
  readonly environment: StripeEnv;
  readonly account: { readonly id: string; readonly name: string | null; readonly chargesEnabled: boolean | null } | null;
  readonly payments: readonly { readonly id: string; readonly amount: number; readonly currency: string; readonly email: string | null; readonly status: string; readonly created: number; readonly dashboardUrl: string }[];
  readonly subscriptions: readonly { readonly id: string; readonly status: string; readonly email: string | null; readonly price: string | null; readonly dashboardUrl: string }[];
  readonly products: readonly { readonly id: string; readonly name: string; readonly prices: readonly { readonly id: string; readonly amount: number | null; readonly currency: string; readonly interval: string | null }[] }[];
  readonly webhookEndpoints: readonly { readonly url: string; readonly status: string }[];
  readonly dashboardUrl: string;
}

export type StripePanelAnswer = StripePanel | { readonly available: true; readonly environment: StripeEnv; readonly account: null };

export interface PanelDeps {
  readonly store: StripeStore;
  readonly secrets: Pick<SecretStore, "values">;
  readonly f?: StripeFetch;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export async function stripePanel(projectId: string, env: StripeEnv, d?: PanelDeps): Promise<StripePanelAnswer> {
  const deps = d ?? (await realDeps());
  const key = (await deps.secrets.values(projectId, env)).STRIPE_SECRET_KEY;
  if (!key) return { available: true, environment: env, account: null };
  const base = env === "draft" ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  const list = async (path: string, query: string): Promise<Obj[]> => {
    const r = await stripeRequest(key, { method: "GET", path, form: query }, deps.f).catch(() => null);
    const data = r && r.status === 200 && isObj(r.json) ? r.json.data : null;
    return Array.isArray(data) ? data.filter(isObj) : [];
  };
  const [sessions, intents, subscriptions, products, prices, endpoints, account] = await Promise.all([
    list("/v1/checkout/sessions", "status=complete&limit=25"),
    list("/v1/payment_intents", "limit=25"),
    list("/v1/subscriptions", "status=active&limit=25&expand%5B%5D=data.customer"),
    list("/v1/products", "active=true&limit=25"),
    list("/v1/prices", "active=true&limit=100"),
    list("/v1/webhook_endpoints", "limit=25"),
    deps.store.getAccount(projectId, env),
  ]);

  const emailOfIntent = new Map<string, string>();
  for (const s of sessions) {
    const pi = str(s.payment_intent);
    const email = isObj(s.customer_details) ? str(s.customer_details.email) : null;
    if (pi && email) emailOfIntent.set(pi, email);
  }
  const payments = intents
    .filter((p) => p.status === "succeeded")
    .map((p) => {
      const id = String(p.id);
      return {
        id,
        amount: num(p.amount) ?? 0,
        currency: String(p.currency ?? ""),
        email: emailOfIntent.get(id) ?? str(p.receipt_email),
        status: String(p.status),
        created: num(p.created) ?? 0,
        dashboardUrl: `${base}/payments/${id}`,
      };
    })
    .sort((a, b) => b.created - a.created);

  return {
    available: true,
    environment: env,
    account: account ? { id: account.accountId, name: account.accountName, chargesEnabled: account.chargesEnabled } : null,
    payments,
    subscriptions: subscriptions.map((s) => {
      const item = isObj(s.items) && Array.isArray(s.items.data) && isObj(s.items.data[0]) ? (s.items.data[0] as Obj) : null;
      const price = item && isObj(item.price) ? item.price : null;
      return {
        id: String(s.id),
        status: String(s.status),
        email: isObj(s.customer) ? str(s.customer.email) : null,
        price: price ? str(price.lookup_key) ?? str(price.nickname) ?? str(price.id) : null,
        dashboardUrl: `${base}/subscriptions/${String(s.id)}`,
      };
    }),
    products: products.map((p) => ({
      id: String(p.id),
      name: String(p.name ?? ""),
      prices: prices
        .filter((pr) => (isObj(pr.product) ? pr.product.id : pr.product) === p.id)
        .map((pr) => ({ id: String(pr.id), amount: num(pr.unit_amount), currency: String(pr.currency ?? ""), interval: isObj(pr.recurring) ? str(pr.recurring.interval) : null })),
    })),
    webhookEndpoints: endpoints.map((e) => ({ url: String(e.url ?? ""), status: String(e.status ?? "") })),
    dashboardUrl: base,
  };
}

async function realDeps(): Promise<PanelDeps> {
  const [{ pgStripeStore }, { pgSecretStore }] = await Promise.all([import("./store-pg"), import("@/lib/functions/secret-store-pg")]);
  return { store: pgStripeStore, secrets: pgSecretStore };
}
