// Smoke test for the Polar billing integration. Run it LOCALLY (it needs your
// network + .env.local) — the agent's sandbox has no egress to Polar.
//
//   npm run billing:smoke
//       → validates POLAR_* env, confirms the token + product, creates a real
//         checkout in your Polar environment, and prints the checkout URL.
//         Open it and pay with the test card 4242 4242 4242 4242 (sandbox).
//
//   npm run billing:smoke -- --webhook=<userId>
//       → signs a `subscription.active` event the way Polar does and POSTs it to
//         your LOCAL /api/billing/webhook, flipping <userId> to Pro WITHOUT a
//         real purchase or a tunnel. (Run `npm run dev` + `npm run billing:migrate`
//         first; then check <app>/api/usage → should show plan "pro", 150 credits.)
//
// Find a userId: it's the `users.id` (UUID) of your account — e.g. from the DB
// or by logging in and hitting /api/usage while signed in.

import { createHmac } from "node:crypto";

function env(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

const SERVER = env("POLAR_SERVER") === "production" ? "production" : "sandbox";
const API = SERVER === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh";
const TOKEN = env("POLAR_ACCESS_TOKEN");
const PRODUCT = env("POLAR_PRODUCT_PRO_ID");
const SECRET = env("POLAR_WEBHOOK_SECRET");
const APP = (env("NEXTAUTH_URL") || env("APP_BASE_URL") || "http://localhost:3000").replace(/\/+$/, "");

function need(name: string, val: string): void {
  if (!val) {
    console.error(`✗ Missing ${name} in .env.local`);
    process.exit(1);
  }
}

async function apiChecks(): Promise<void> {
  need("POLAR_ACCESS_TOKEN", TOKEN);
  need("POLAR_PRODUCT_PRO_ID", PRODUCT);
  console.log(`Polar environment: ${SERVER}  (${API})\n`);

  const pr = await fetch(`${API}/v1/products/${PRODUCT}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!pr.ok) {
    console.error(`✗ GET product -> HTTP ${pr.status}: ${(await pr.text()).slice(0, 400)}`);
    process.exit(1);
  }
  const product = (await pr.json()) as {
    name?: string;
    is_recurring?: boolean;
    recurring_interval?: string;
    prices?: Array<{ price_amount?: number; price_currency?: string; recurring_interval?: string }>;
  };
  const price = product.prices?.[0];
  const amount = typeof price?.price_amount === "number" ? (price.price_amount / 100).toFixed(2) : "?";
  console.log(
    `✓ Product OK: "${product.name}"  recurring=${product.is_recurring}  ` +
      `interval=${product.recurring_interval ?? price?.recurring_interval ?? "?"}  ` +
      `price=${amount} ${price?.price_currency ?? ""}`,
  );

  const cr = await fetch(`${API}/v1/checkouts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      products: [PRODUCT],
      success_url: `${APP}/en/projects?upgraded=1`,
      customer_external_id: "smoke_test_user",
      metadata: { userId: "smoke_test_user" },
    }),
  });
  if (!cr.ok) {
    console.error(`✗ POST checkout -> HTTP ${cr.status}: ${(await cr.text()).slice(0, 400)}`);
    process.exit(1);
  }
  const checkout = (await cr.json()) as { url?: string };
  console.log(`✓ Checkout created.\n\n   Open this URL and pay with 4242 4242 4242 4242:\n   ${checkout.url}\n`);
  console.log("After paying, Polar fires the webhook to your configured endpoint — watch the `next dev` terminal.");
  console.log("(No public endpoint yet? Test the webhook locally instead: npm run billing:smoke -- --webhook=<yourUserId>)");
}

async function simulateWebhook(userId: string): Promise<void> {
  need("POLAR_WEBHOOK_SECRET", SECRET);
  if (!userId) {
    console.error("✗ Pass a user id: npm run billing:smoke -- --webhook=<userId>");
    process.exit(1);
  }
  const id = "evt_smoke";
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({
    type: "subscription.active",
    data: {
      id: "sub_smoke",
      status: "active",
      customer_id: "cus_smoke",
      customer: { external_id: userId },
      metadata: { userId },
    },
  });
  // Polar signs with the secret string used verbatim as the raw HMAC key.
  const sig = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${id}.${ts}.${payload}`)
    .digest("base64");
  const url = `${APP}/api/billing/webhook`;
  console.log(`POSTing a signed subscription.active for "${userId}" -> ${url}\n`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": `v1,${sig}`,
      "content-type": "application/json",
    },
    body: payload,
  });
  console.log(`webhook responded: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  if (res.ok) {
    console.log(
      `\n✓ Handler accepted the event. If \`next dev\` is up and \`billing:migrate\` ran, ` +
        `${userId} is now Pro.\n   Confirm at ${APP}/api/usage  ->  {"plan":"pro","credits":{"balance":150,...}}`,
    );
  } else {
    console.log("\n✗ Non-2xx. Common causes: dev server not running, wrong POLAR_WEBHOOK_SECRET, or columns not migrated.");
  }
}

const webhookArg = process.argv.find((a) => a.startsWith("--webhook="));
if (webhookArg) {
  void simulateWebhook(webhookArg.slice("--webhook=".length));
} else {
  void apiChecks();
}
