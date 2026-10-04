import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { CREDITS_BY_PLAN } from "@/lib/credits";
import { PLAN_RANK, planFromDb } from "@/lib/plan";
import type { PolarSubscription } from "./renewal-reminder";
import { publicOrigin } from "@/lib/integrations/oauth";
import { verifyWebhookSignature } from "./webhook-signature";

// ───────────────────────────────────────────────────────────────────────────
// Polar (Merchant-of-Record) billing — the paid "Pro" tier.
//
// Polar is the legal SELLER of record: it runs the hosted checkout, invoices
// the customer, and collects/remits VAT/sales tax worldwide. We never touch a
// card or issue a customer factura. This module is the thin server glue:
//   • createCheckout()          → a hosted Polar checkout URL for the Pro product
//   • createCustomerPortalUrl() → a hosted "manage subscription" URL
//   • applySubscriptionState()  → flip users.plan + grant/clear Pro credits
//   • verifyWebhookSignature    → re-exported from ./webhook-signature (pure)
//
// Mapping a Polar customer back to an OpenLen user: we pass our userId as the
// checkout's `customer_external_id` AND in `metadata.userId`, so every webhook
// carries it back. No OAuth, no per-user token — unlike lib/integrations/*.
//
// Hand-rolled against Polar's v1 REST API (same fetch-based style as
// lib/integrations/vercel.ts + github.ts) rather than pulling in the Polar SDK.
// ───────────────────────────────────────────────────────────────────────────

export { verifyWebhookSignature };

export class BillingError extends Error {}

function env(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

// Default to SANDBOX — going live requires an explicit POLAR_SERVER=production,
// so a misconfigured box can never accidentally take real payments.
function apiBase(): string {
  return env("POLAR_SERVER") === "production"
    ? "https://api.polar.sh"
    : "https://sandbox-api.polar.sh";
}

/** True when the Pro checkout can actually run (token + product configured). */
export function billingConfigured(): boolean {
  return !!(env("POLAR_ACCESS_TOKEN") && env("POLAR_PRODUCT_PRO_ID"));
}

/** Los dos planes de pago que vende Polar (04/10: Pro $10 y Max $20). */
export type PaidPlan = "pro" | "max";

/** El plan de una suscripción, por su producto. Max sólo si es el producto de
 *  Max (POLAR_PRODUCT_MAX_ID); cualquier otro es Pro. Así el Pro de antes, a
 *  $3.99 —Polar le guarda el precio y Jesús decidió que reciba lo mismo que un
 *  Pro nuevo—, sigue siendo Pro sin que el código tenga que distinguirlo. */
export function planForProduct(productId: string | null | undefined): PaidPlan {
  const max = env("POLAR_PRODUCT_MAX_ID");
  return max && productId === max ? "max" : "pro";
}

async function polarPost(path: string, body: unknown): Promise<unknown> {
  const token = env("POLAR_ACCESS_TOKEN");
  if (!token) throw new BillingError("not_configured");
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new BillingError(`polar ${path} ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** Una suscripción tal como la tiene Polar (`GET /v1/subscriptions/{id}`):
 *  su próxima renovación, si va a cancelarse y el importe que paga esa
 *  persona. Lo usa el recordatorio de renovación. El token necesita el permiso
 *  `subscriptions:read`. */
export async function getSubscription(id: string): Promise<PolarSubscription> {
  const token = env("POLAR_ACCESS_TOKEN");
  if (!token) throw new BillingError("not_configured");
  const res = await fetch(`${apiBase()}/v1/subscriptions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new BillingError(`polar subscription ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as PolarSubscription;
}

/** Create a hosted checkout for a paid plan (Pro by default) and return its
 *  URL. Max sin su producto configurado falla: nunca vende Pro en su lugar. */
export async function createCheckout(opts: {
  userId: string;
  email?: string | null;
  locale?: string;
  plan?: PaidPlan;
}): Promise<string> {
  const productId = env(opts.plan === "max" ? "POLAR_PRODUCT_MAX_ID" : "POLAR_PRODUCT_PRO_ID");
  if (!productId) throw new BillingError("not_configured");
  const locale = opts.locale === "es" ? "es" : "en";
  const successUrl = `${publicOrigin()}/${locale}/projects?upgraded=1`;
  const data = (await polarPost("/v1/checkouts/", {
    products: [productId],
    success_url: successUrl,
    customer_external_id: opts.userId,
    customer_email: opts.email || undefined,
    metadata: { userId: opts.userId },
  })) as { url?: unknown };
  if (typeof data.url !== "string") throw new BillingError("checkout_no_url");
  return data.url;
}

/** Create a hosted customer-portal session (manage/cancel subscription). The
 *  customer must already exist in Polar (created at first checkout). */
export async function createCustomerPortalUrl(userId: string): Promise<string> {
  const data = (await polarPost("/v1/customer-sessions/", {
    customer_external_id: userId,
  })) as { customer_portal_url?: unknown };
  if (typeof data.customer_portal_url !== "string") {
    throw new BillingError("portal_no_url");
  }
  return data.customer_portal_url;
}

// ── Plan state transitions ──────────────────────────────────────────────────

// Statuses that keep Pro ACCESS. past_due is included so a failed renewal
// doesn't instantly lock a paying user out while Polar retries the charge —
// credits are NOT refilled on it (the wasPro guard below handles that).
const ACCESS_STATUSES = new Set(["active", "trialing", "past_due"]);
// Statuses where the subscription is definitively over — downgrade to free.
const TERMINAL_STATUSES = new Set([
  "canceled",
  "unpaid",
  "revoked",
  "incomplete_expired",
]);

/**
 * Reconcile a user's plan with the latest subscription status from Polar.
 * Access statuses (active/trialing/past_due) → "pro" (and grant the Pro credit
 * allotment on the FIRST free → pro transition only, so repeated webhooks —
 * including past_due — can't be used to refill); terminal statuses
 * (canceled/unpaid/revoked/incomplete_expired) → "free". The monthly credit
 * reset in lib/credits.ts handles renewals, so we deliberately don't refill on
 * every active webhook. Any other/unknown status leaves the plan unchanged.
 */
export async function applySubscriptionState(params: {
  userId: string;
  status: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  /** El plan del producto de la suscripción (`planForProduct`). Pro si no
   *  se sabe: un reembolso, por ejemplo, sólo trae el estado. */
  plan?: PaidPlan;
}): Promise<void> {
  const rows = await db
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, params.userId))
    .limit(1);
  if (!rows[0]) return; // unknown user — nothing to do

  if (ACCESS_STATUSES.has(params.status)) {
    const plan = params.plan ?? "pro";
    // Créditos SÓLO al subir de plan (gratis → pro, gratis → max, pro → max).
    // Quedarse (los webhooks repetidos, past_due) o bajar (max → pro) no
    // recarga: si no, cada aviso de Polar sería una recarga gratis.
    const upgrade = PLAN_RANK[plan] > PLAN_RANK[planFromDb(rows[0].plan)];
    await db
      .update(schema.users)
      .set({
        plan,
        // Don't overwrite an existing id with null — only set when we have one.
        ...(params.customerId
          ? { polarCustomerId: params.customerId }
          : {}),
        polarSubscriptionId: params.subscriptionId ?? undefined,
        subscriptionStatus: params.status,
        ...(upgrade
          ? { credits: CREDITS_BY_PLAN[plan], creditsRefreshedAt: new Date() }
          : {}),
      })
      .where(eq(schema.users.id, params.userId));
    return;
  }

  if (TERMINAL_STATUSES.has(params.status)) {
    await db
      .update(schema.users)
      .set({ plan: "free", subscriptionStatus: params.status })
      .where(eq(schema.users.id, params.userId));
  }
  // Any other/unknown status: leave the plan unchanged.
}

/** Pull our userId out of a Polar subscription payload. We set both
 *  customer_external_id and metadata.userId at checkout, so either resolves. */
export function userIdFromPayload(data: {
  customer?: { external_id?: unknown } | null;
  customer_external_id?: unknown;
  metadata?: { userId?: unknown } | null;
}): string | null {
  const fromCustomer = data.customer?.external_id;
  if (typeof fromCustomer === "string" && fromCustomer) return fromCustomer;
  if (
    typeof data.customer_external_id === "string" &&
    data.customer_external_id
  ) {
    return data.customer_external_id;
  }
  const fromMeta = data.metadata?.userId;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return null;
}
