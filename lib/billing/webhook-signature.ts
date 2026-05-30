import { createHmac, timingSafeEqual } from "node:crypto";

// ───────────────────────────────────────────────────────────────────────────
// Polar webhook signature verification (standard-webhooks spec).
//
// Isolated from polar.ts (which pulls in the DB + env) so it stays a pure,
// dependency-free function that's cheap to unit-test (webhook-signature.test.ts
// pins it against the canonical standard-webhooks test vector).
//
// Scheme: signed content is `${id}.${timestamp}.${payload}`, HMAC-SHA256 with
// the base64-decoded webhook secret (the `whsec_` prefix, if present, is
// stripped), base64 digest. The `webhook-signature` header is a
// space-separated list of `v1,<sig>` entries — a match against any wins.
// ───────────────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyWebhookSignature(opts: {
  secret: string;
  id: string;
  timestamp: string;
  signatureHeader: string;
  payload: string;
}): boolean {
  if (!opts.id || !opts.timestamp || !opts.signatureHeader || !opts.secret) {
    return false;
  }
  const rawSecret = opts.secret.startsWith("whsec_")
    ? opts.secret.slice("whsec_".length)
    : opts.secret;
  const key = Buffer.from(rawSecret, "base64");
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${opts.id}.${opts.timestamp}.${opts.payload}`)
    .digest("base64");

  for (const entry of opts.signatureHeader.split(" ")) {
    const comma = entry.indexOf(",");
    const sig = comma === -1 ? entry : entry.slice(comma + 1);
    if (sig && safeEqual(sig, expected)) return true;
  }
  return false;
}
