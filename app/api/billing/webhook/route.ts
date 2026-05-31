import {
  applySubscriptionState,
  userIdFromPayload,
  verifyWebhookSignature,
} from "@/lib/billing/polar";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How far the webhook-timestamp may drift from now before we reject it as a
// replay (standard-webhooks recommends ±5 min).
const TIMESTAMP_TOLERANCE_MS = 300_000;

// POST /api/billing/webhook — Polar (standard-webhooks).
//
// MUST read the raw body for signature verification BEFORE parsing: req.json()
// would reformat the bytes and break the HMAC. Order is: verify signature →
// freshness (timestamp) → dedup (webhook-id) → process. Only subscription.*
// and refund/dispute events change a plan; everything else is acknowledged
// with 200 so Polar doesn't retry.
export async function POST(req: Request): Promise<Response> {
  const secret = (process.env.POLAR_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    console.error("POLAR_WEBHOOK_SECRET not configured — webhook rejected");
    return new Response("not_configured", { status: 500 });
  }

  const payload = await req.text();
  const h = req.headers;
  const id = h.get("webhook-id") ?? h.get("svix-id") ?? "";
  const timestamp = h.get("webhook-timestamp") ?? h.get("svix-timestamp") ?? "";
  const signatureHeader =
    h.get("webhook-signature") ?? h.get("svix-signature") ?? "";

  if (
    !verifyWebhookSignature({ secret, id, timestamp, signatureHeader, payload })
  ) {
    return new Response("bad signature", { status: 403 });
  }

  // Freshness — reject a stale/missing timestamp (replay protection). The
  // header is unix SECONDS.
  const tsSeconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(tsSeconds) ||
    Math.abs(Date.now() - tsSeconds * 1000) > TIMESTAMP_TOLERANCE_MS
  ) {
    return new Response("stale", { status: 403 });
  }

  // Dedup — Polar retries deliveries; processing the same webhook-id twice
  // could double-apply a transition. INSERT first; an empty RETURNING means we
  // already handled this id, so ack without reprocessing.
  const inserted = await db
    .insert(schema.processedWebhooks)
    .values({ id })
    .onConflictDoNothing()
    .returning({ id: schema.processedWebhooks.id });
  if (inserted.length === 0) {
    return new Response("ok", { status: 200 });
  }

  let event: { type?: unknown; data?: unknown };
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const type = typeof event.type === "string" ? event.type : "";
  if (type.startsWith("subscription.")) {
    const data = (event.data ?? {}) as {
      id?: unknown;
      status?: unknown;
      customer_id?: unknown;
      customer?: { external_id?: unknown } | null;
      customer_external_id?: unknown;
      metadata?: { userId?: unknown } | null;
    };
    const userId = userIdFromPayload(data);
    const status = typeof data.status === "string" ? data.status : "";
    if (userId && status) {
      await applySubscriptionState({
        userId,
        status,
        customerId: polarCustomerId(data),
        subscriptionId: typeof data.id === "string" ? data.id : null,
      });
    }
  } else if (type === "order.refunded" || type === "order.disputed") {
    // A refund/dispute revokes Pro — map back to our user and downgrade.
    const data = (event.data ?? {}) as {
      customer?: { external_id?: unknown } | null;
      customer_external_id?: unknown;
      metadata?: { userId?: unknown } | null;
    };
    const userId = userIdFromPayload(data);
    if (userId) {
      await applySubscriptionState({ userId, status: "revoked" });
    }
  } else {
    // Observability: surface the exact event names Polar sends in prod so we
    // can confirm the refund/dispute mapping above (the names are unconfirmed).
    console.warn(`billing webhook: unhandled event type ${type}`);
  }

  return new Response("ok", { status: 200 });
}

// Prefer customer_id; fall back to customer.external_id so the Polar customer
// is still linked when only the external form is present.
function polarCustomerId(data: {
  customer_id?: unknown;
  customer?: { external_id?: unknown } | null;
}): string | null {
  if (typeof data.customer_id === "string" && data.customer_id) {
    return data.customer_id;
  }
  const ext = data.customer?.external_id;
  if (typeof ext === "string" && ext) return ext;
  return null;
}
