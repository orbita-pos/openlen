// Confirming the email after signing up (2026-10-21, «sin bloquear»): the account works from the first
// moment, and the link the sign-up emails marks the address verified (`users.emailVerified`). What it
// changes: an unverified account gives way to whoever signs in with Google with that address
// (./google-takeover.ts), since signing up with a password never proved the address was yours.
//
// The token lives in Auth.js's `verificationTokens` (unused otherwise: there is no email provider), as
// its SHA-256 only, under `verify:<email>`; one use, 24 hours.

import crypto from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const TTL_MS = 24 * 60 * 60_000;
const PREFIX = "verify:";
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** A new link's token for `email` (the raw one goes in the email; the database keeps its hash). */
export async function crearVerificacionDelCorreo(email: string, now: Date = new Date()): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.verificationTokens).values({ identifier: `${PREFIX}${email}`, token: sha256(raw), expires: new Date(now.getTime() + TTL_MS) });
  return raw;
}

/** The link, from the server's own address (never the request's: see app/api/auth/forgot). */
export function enlaceDeVerificacion(raw: string): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base}/verificar/${raw}`;
}

/** Spends the token and marks its address verified; false for a wrong, used or expired one. */
export async function verificarCorreo(raw: string, now: Date = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return false;
  const [spent] = await db
    .delete(schema.verificationTokens)
    .where(and(eq(schema.verificationTokens.token, sha256(raw)), gt(schema.verificationTokens.expires, now)))
    .returning({ identifier: schema.verificationTokens.identifier });
  if (!spent?.identifier.startsWith(PREFIX)) return false;
  const email = spent.identifier.slice(PREFIX.length);
  await db.update(schema.users).set({ emailVerified: now }).where(and(eq(schema.users.email, email), isNull(schema.users.emailVerified)));
  return true;
}
