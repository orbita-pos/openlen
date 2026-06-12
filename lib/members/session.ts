// Member sessions — a signed JWT in a host-only cookie on the SITE's domain.
//
// Deliberately separate from Auth.js (that's the platform account on
// openlen.com): the member cookie is set by /api/m/[sub]/auth/verify on
// <sub>.openlen.com (or the custom domain), carries no Domain attribute so the
// browser scopes it to that exact host, and names a (member, project) pair.
// The key derives from NEXTAUTH_SECRET via HKDF — same no-new-secret approach
// as lib/integrations/crypto.ts, different salt/info so keys never collide.

import { hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const MEMBER_COOKIE = "ol_member";

const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days

export interface MemberSessionClaims {
  memberId: string;
  projectId: string;
}

function getKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to sign member sessions.");
  }
  return new Uint8Array(
    hkdfSync("sha256", secret, "openlen-member-session", "ol-member-jwt", 32),
  );
}

export async function signMemberSession(
  claims: MemberSessionClaims,
): Promise<string> {
  return new SignJWT({ mid: claims.memberId, pid: claims.projectId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(getKey());
}

/** Null on any failure — expired, tampered, wrong key, malformed claims. */
export async function verifyMemberSession(
  token: string,
): Promise<MemberSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ["HS256"],
    });
    const { mid, pid } = payload;
    if (typeof mid !== "string" || typeof pid !== "string") return null;
    return { memberId: mid, projectId: pid };
  } catch {
    return null;
  }
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
