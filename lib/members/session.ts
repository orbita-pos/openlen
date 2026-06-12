// Member sessions — opaque server-side tokens in a host-only cookie.
//
// Supabase-reference design, collapsed to our workload: their revocation +
// theft-containment story lives in single-use refresh-token ROWS, with
// short stateless access JWTs on top because their backends verify millions
// of calls without a session lookup. Our protected fetches already hit the
// DB once per request (member-row check), so the stateless layer buys
// nothing — the cookie carries a raw 256-bit token, only its sha256 is
// stored (memberSessions), and verification IS the row lookup. Deleting a
// row is the revocation; there is no signing key, so there is nothing to
// rotate and a leaked platform secret can't mint member sessions.
//
// Deliberately separate from Auth.js (the platform account on openlen.com):
// this cookie is set by /api/m/[sub]/auth/verify on the SITE's own host,
// carries no Domain attribute (host-only is the isolation between sites).

import crypto from "node:crypto";

export const MEMBER_COOKIE = "ol_member";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, absolute
const SESSION_TTL_S = SESSION_TTL_MS / 1000;

/** Raw token goes in the cookie; only the hash ever touches the DB. */
export function generateSessionToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashSessionToken(raw) };
}

export function hashSessionToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// No Domain attribute — host-only is the isolation mechanism (a session on
// site A's host is invisible to site B). SameSite=Lax keeps the cookie on
// top-level navigations (the post-login redirect) while blocking cross-site
// POSTs from carrying it.
export function buildMemberCookie(token: string): string {
  return `${MEMBER_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; SameSite=Lax${secureSuffix()}`;
}

export function clearMemberCookie(): string {
  return `${MEMBER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureSuffix()}`;
}

function secureSuffix(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function readMemberCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== MEMBER_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length > 0) return value;
  }
  return null;
}
