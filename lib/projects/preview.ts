// Preview-link tokens — opaque, stored, per-project revocable.
//
// Unlike the broadcast/booking tokens (stateless HMACs, deliberately NOT
// revocable), a draft-preview link MUST be revocable on demand: a creator
// shares an unpublished draft, then kills the link. So it's an opaque random
// token stored on the project (data.preview.token) — deleting it IS the
// revocation, rotating it invalidates the old link. Mirrors the member-session
// token model (lib/members/session.ts), not the unsubscribe HMAC.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

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
  return constantTimeEqual(stored, provided);
}

// ── Optional controls: expiry + passcode (Vercel-parity) ─────────────────────
//
// Passcode is stored HASHED (HMAC, never plaintext). The viewer enters it on a
// gate page; on success the public route sets a short signed UNLOCK cookie so a
// refresh stays open without re-asking. Both the hash and the cookie derive
// from NEXTAUTH_SECRET via HKDF (no new secret) — same no-new-secret posture as
// the broadcast/unsubscribe tokens. The cookie is bound to the current
// passcodeHash, so changing or clearing the passcode invalidates outstanding
// unlock cookies for free.

function deriveKey(info: string): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for preview passcodes.");
  }
  return Buffer.from(hkdfSync("sha256", secret, info, "ol-preview", 32));
}

/** Hash a passcode for storage. Per-project (the projectId is in the message),
 *  so the same passcode on two projects yields different hashes. */
export function hashPasscode(projectId: string, passcode: string): string {
  return createHmac("sha256", deriveKey("openlen-preview-passcode"))
    .update(`${projectId}:${passcode}`)
    .digest("base64url");
}

/** Constant-time verify a request passcode against the stored hash. */
export function verifyPasscode(
  projectId: string,
  passcode: string | null | undefined,
  storedHash: string | null | undefined,
): boolean {
  if (!passcode || !storedHash) return false;
  return constantTimeEqual(hashPasscode(projectId, passcode), storedHash);
}

/** The signed value of the unlock cookie set after a correct passcode. Bound to
 *  the current passcodeHash → rotating/clearing the passcode invalidates it. */
export function previewUnlockToken(
  projectId: string,
  passcodeHash: string,
): string {
  return createHmac("sha256", deriveKey("openlen-preview-unlock"))
    .update(`${projectId}:${passcodeHash}`)
    .digest("base64url");
}

/** Constant-time verify an unlock cookie value. */
export function verifyUnlockToken(
  projectId: string,
  passcodeHash: string,
  cookieValue: string | null | undefined,
): boolean {
  if (!cookieValue) return false;
  return constantTimeEqual(previewUnlockToken(projectId, passcodeHash), cookieValue);
}

/** True once the link has passed its expiry. Absent/empty = never expires; a
 *  malformed timestamp is treated as expired (fail closed). */
export function isPreviewExpired(
  expiresAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return nowMs >= t;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
