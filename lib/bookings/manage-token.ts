// Booking manage tokens — stateless, stable, non-expiring (mirrors the
// broadcast unsubscribe token). A booking confirmation email carries a link
// that lets the visitor cancel or reschedule WITHOUT a login, so the token
// must be derivable on demand and verifiable by recompute — nothing stored.
//
// It's an HMAC of (projectId, bookingId); the key derives from NEXTAUTH_SECRET
// via HKDF (no new secret), so rotating that secret invalidates outstanding
// manage links — don't rotate casually. Leak posture: a token only lets a
// holder manage THAT booking on THAT project — no escalation, no enumeration
// (bookingId is a random UUID).

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for booking manage tokens.");
  }
  return Buffer.from(
    hkdfSync("sha256", secret, "openlen-bookings-manage", "ol-bk-manage", 32),
  );
}

export function manageToken(projectId: string, bookingId: string): string {
  return createHmac("sha256", getKey())
    .update(`${projectId}:${bookingId}`)
    .digest("base64url");
}

/** Constant-time verify. False on any mismatch, length difference, or
 *  malformed input — never throws. */
export function verifyManageToken(
  projectId: string,
  bookingId: string,
  token: string,
): boolean {
  if (!token) return false;
  const expected = manageToken(projectId, bookingId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** The manage URL baked into a booking email. Lives on the SITE host under
 *  /api/bk/<sub>/ (mirrors /api/m/, /api/cm/, /api/b/). */
export function manageUrl(params: {
  baseUrl: string; // https://<sub>.<host>  (no trailing slash)
  sub: string;
  projectId: string;
  bookingId: string;
}): string {
  const t = manageToken(params.projectId, params.bookingId);
  const b = encodeURIComponent(params.bookingId);
  return `${params.baseUrl}/api/bk/${params.sub}/manage?b=${b}&t=${t}`;
}
