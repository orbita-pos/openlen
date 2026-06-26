// Private-chat sessions — opaque server-side tokens in a host-only cookie.
// Same design as members (lib/members/session.ts): the cookie carries a raw
// 256-bit token, only its sha256 is stored (chatSessions), verification IS the
// row lookup, deleting a row is the revocation. Deliberately separate from
// Auth.js and from the member cookie — host-only is the isolation between sites.

import crypto from "node:crypto";

export const CHAT_COOKIE = "ol_chat";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, absolute
const SESSION_TTL_S = SESSION_TTL_MS / 1000;

export function generateSessionToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashSessionToken(raw) };
}

export function hashSessionToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function buildChatCookie(token: string): string {
  return `${CHAT_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; SameSite=Lax${secureSuffix()}`;
}

export function clearChatCookie(): string {
  return `${CHAT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureSuffix()}`;
}

function secureSuffix(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function readChatCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== CHAT_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length > 0) return value;
  }
  return null;
}
