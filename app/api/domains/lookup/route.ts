import { lookupDomain } from "@/lib/custom-domains";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/domains/lookup?host=X
//
// Caddy's `on_demand_tls.ask` endpoint. Caddy hits it on every TLS handshake
// for a host that doesn't have a cert yet — we respond:
//
//   200 → "host is claimed AND verified, you may issue a cert"
//   404 → "unknown host, refuse the handshake"
//
// Without this gate, anyone could DNS-point arbitrary hostnames at our IP
// and force Caddy into Let's Encrypt rate-limit hell. The verified flag in
// `customDomains` is the only path to a 200.
//
// Intentionally unauthenticated — Caddy can't carry a session token. The
// response body is opaque ({ok:1}); the only information it leaks is "this
// host exists as a claim", which is unavoidable since DNS already exposes
// the same fact.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
// Don't let Next cache the result — claim/verify state changes need to
// take effect on the next Caddy hit, not after the cache window.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Caddy's `on_demand_tls.ask` directive appends `?domain=<hostname>` to
  // the URL it calls (NOT `?host=` — that's a common gotcha). Accept both
  // so the endpoint works whether called by Caddy (`domain`) or by
  // anything else we wire up later (`host`).
  const host =
    url.searchParams.get("domain") ?? url.searchParams.get("host");
  if (!host) {
    return new Response("missing host", { status: 400 });
  }
  const found = await lookupDomain(host);
  if (!found || !found.verified) {
    return new Response("not found", { status: 404 });
  }
  return new Response(JSON.stringify({ ok: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
