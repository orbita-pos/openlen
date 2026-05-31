import { createHmac, timingSafeEqual } from "node:crypto";

// ───────────────────────────────────────────────────────────────────────────
// Polar webhook signature verification (standard-webhooks-style).
//
// Isolated from polar.ts (which pulls in the DB + env) so it stays a pure,
// dependency-free function that's cheap to unit-test (webhook-signature.test.ts).
//
// Scheme: the signed content is `${id}.${timestamp}.${payload}`, HMAC-SHA256,
// base64 digest. The `webhook-signature` header is a space-separated list of
// `v1,<sig>` entries — a match against any wins.
//
// THE SECRET-AS-KEY GOTCHA: the standard-webhooks/Svix spec base64-DECODES the
// secret (after stripping a `whsec_` prefix) to get the HMAC key. Polar is
// widely reported to DEVIATE and use the secret string verbatim (including any
// `whsec_` prefix) as the raw UTF-8 key. To be robust to whichever scheme the
// configured secret actually uses, we compute the expected signature under all
// plausible key derivations and accept if ANY matches. This is safe — every
// derivation uses the same shared secret, so it doesn't weaken verification; it
// only tolerates the encoding ambiguity that otherwise breaks billing silently.
// (Refs: Polar docs + community reports, 2025-2026.)
// ───────────────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Every plausible HMAC key derivation from the configured secret.
function candidateKeys(secret: string): Buffer[] {
  const stripped = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const keys: Buffer[] = [
    Buffer.from(secret, "utf8"), // Polar: full secret string, raw bytes
  ];
  if (stripped !== secret) keys.push(Buffer.from(stripped, "utf8")); // raw, prefix stripped
  const b64 = Buffer.from(stripped, "base64"); // standard-webhooks / Svix
  if (b64.length > 0) keys.push(b64);
  return keys;
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

  const signed = `${opts.id}.${opts.timestamp}.${opts.payload}`;
  const headerSigs: string[] = [];
  for (const entry of opts.signatureHeader.split(" ")) {
    const comma = entry.indexOf(",");
    const sig = comma === -1 ? entry : entry.slice(comma + 1);
    if (sig) headerSigs.push(sig);
  }
  if (headerSigs.length === 0) return false;

  for (const key of candidateKeys(opts.secret)) {
    const expected = createHmac("sha256", key).update(signed).digest("base64");
    for (const sig of headerSigs) {
      if (safeEqual(sig, expected)) return true;
    }
  }
  return false;
}
