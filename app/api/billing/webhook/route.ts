import {
  applySubscriptionState,
  userIdFromPayload,
  verifyWebhookSignature,
} from "@/lib/billing/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/webhook — Polar (standard-webhooks).
//
// MUST read the raw body for signature verification BEFORE parsing: req.json()
// would reformat the bytes and break the HMAC. After verifying, only
// subscription.* events change a plan; everything else is acknowledged with
// 200 so Polar doesn't retry.
export async function POST(req: Request): Promise<Response> {
  const secret = (process.env.POLAR_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return new Response("not_configured", { status: 500 });

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
        customerId:
          typeof data.customer_id === "string" ? data.customer_id : null,
        subscriptionId: typeof data.id === "string" ? data.id : null,
      });
    }
  }

  return new Response("ok", { status: 200 });
}
