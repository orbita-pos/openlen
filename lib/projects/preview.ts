// Preview-link tokens — opaque, stored, per-project revocable.
//
// Unlike the broadcast/booking tokens (stateless HMACs, deliberately NOT
// revocable), a draft-preview link MUST be revocable on demand: a creator
// shares an unpublished draft, then kills the link. So it's an opaque random
// token stored on the project (data.preview.token) — deleting it IS the
// revocation, rotating it invalidates the old link. Mirrors the member-session
// token model (lib/members/session.ts), not the unsubscribe HMAC.

import { randomBytes, timingSafeEqual } from "node:crypto";

/** A fresh 256-bit URL-safe preview token (43 base64url chars). */
export function generatePreviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare of a stored token against a request-supplied one.
 *  False on any empty / length-mismatch / malformed input — never throws, so
 *  the public preview handler can call it on untrusted query input directly. */
export function previewTokenMatches(
  stored: string | null | undefined,
  provided: string | null | undefined,
): boolean {
  if (!stored || !provided) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
