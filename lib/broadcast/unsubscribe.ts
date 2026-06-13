// Unsubscribe tokens — stateless, stable, non-expiring.
//
// Unlike the members LOGIN token (single-use, random, stored), an unsubscribe
// token is the opposite: it must work forever from any old email, and there's
// no value in storing one row per (member, campaign). So it's a deterministic
// HMAC of (projectId, memberId) — derivable on demand, verifiable by recompute,
// nothing to persist. The key derives from NEXTAUTH_SECRET via HKDF (same
// no-new-secret approach as the member session), so rotating that secret
// invalidates outstanding links — don't rotate casually.
//
// Leak posture: a token only lets a holder unsubscribe THAT member from THAT
// project — no escalation. A member re-subscribes by the owner clearing the
// suppression (a future self-serve re-subscribe is out of v1 scope).

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for unsubscribe tokens.");
  }
  return Buffer.from(
    hkdfSync("sha256", secret, "openlen-broadcast-unsub", "ol-unsub", 32),
  );
}

export function unsubscribeToken(projectId: string, memberId: string): string {
  return createHmac("sha256", getKey())
    .update(`${projectId}:${memberId}`)
    .digest("base64url");
}

/** Constant-time verify. False on any mismatch, length difference, or
 *  malformed input — never throws. */
export function verifyUnsubscribe(
  projectId: string,
  memberId: string,
  token: string,
): boolean {
  if (!token) return false;
  const expected = unsubscribeToken(projectId, memberId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** The unsubscribe URL baked into a broadcast email for one recipient. Lives
 *  on the SITE host under /api/b/<sub>/ (mirrors /api/m/ and /api/f/). */
export function unsubscribeUrl(params: {
  baseUrl: string; // https://<sub>.<host>  (no trailing slash)
  sub: string;
  projectId: string;
  memberId: string;
}): string {
  const t = unsubscribeToken(params.projectId, params.memberId);
  const m = encodeURIComponent(params.memberId);
  return `${params.baseUrl}/api/b/${params.sub}/unsubscribe?m=${m}&t=${t}`;
}
