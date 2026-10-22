// Google wins over an unverified sign-up (2026-10-21). Signing up with a password doesn't prove the
// address, so anyone could register someone else's email first. When the address's real owner signs in
// with Google (which does prove it, `email_verified`), the account becomes theirs: Google is linked, the
// password goes, `emailVerified` is set, and the sessions and phone keys already open close
// (lib/auth/session-cutoff.ts). A verified account, or one that already has a Google account, stays as
// it was: Auth.js then refuses to link it, as before. Called from auth.ts's signIn callback, BEFORE
// Auth.js decides about linking: it looks the Google account up again afterwards and finds this one.

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { passwordCutoff } from "./session-cutoff";

export async function cederAGoogle(p: { readonly email: string; readonly providerAccountId: string; readonly type: string }, now: Date = new Date()): Promise<boolean> {
  const email = p.email.toLowerCase().trim();
  const [u] = await db.select({ id: schema.users.id, emailVerified: schema.users.emailVerified }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!u || u.emailVerified) return false;
  const [google] = await db
    .select({ id: schema.accounts.providerAccountId })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, u.id), eq(schema.accounts.provider, "google")))
    .limit(1);
  if (google) return false;
  await db.transaction(async (tx) => {
    await tx.insert(schema.accounts).values({ userId: u.id, type: p.type as typeof schema.accounts.$inferInsert.type, provider: "google", providerAccountId: p.providerAccountId });
    await tx.update(schema.users).set({ passwordHash: null, emailVerified: now, passwordChangedAt: now }).where(eq(schema.users.id, u.id));
    await tx.delete(schema.movilLlaves).where(eq(schema.movilLlaves.userId, u.id));
  });
  passwordCutoff.forget(u.id);
  return true;
}
