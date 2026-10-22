// @vitest-environment node
//
// Google wins over an unverified sign-up (2026-10-21): someone could register another person's email
// with a password, since signing up doesn't prove the address. If that person later signs in with
// Google (which does prove it), the account becomes theirs: Google is linked, the password goes, the
// sessions and phone keys already open close. A VERIFIED account stays as it was. Real Postgres.
import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, schema } from "@/lib/db";

import { cederAGoogle } from "./google-takeover";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const made: string[] = [];

async function user(o: { verified?: boolean; google?: boolean } = {}) {
  const id = crypto.randomUUID();
  made.push(id);
  const email = `takeover-${id}@openlen.test`;
  await db.insert(schema.users).values({ id, email, passwordHash: "squatter", emailVerified: o.verified ? new Date() : null });
  await db.insert(schema.movilLlaves).values({ huella: crypto.randomUUID(), userId: id });
  if (o.google) await db.insert(schema.accounts).values({ userId: id, type: "oidc", provider: "google", providerAccountId: `g-old-${id}` });
  return { id, email };
}
const row = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!;

describe.skipIf(!HAS_DB)("🔴 cederAGoogle", () => {
  afterAll(async () => {
    for (const id of made) await db.delete(schema.users).where(eq(schema.users.id, id));
  });

  it("an unverified account with Google's email becomes Google's: linked, no password, verified, its sessions and keys closed", async () => {
    const u = await user();
    expect(await cederAGoogle({ email: u.email.toUpperCase(), providerAccountId: `g-${u.id}`, type: "oidc" })).toBe(true);
    const linked = await db.select().from(schema.accounts).where(and(eq(schema.accounts.provider, "google"), eq(schema.accounts.providerAccountId, `g-${u.id}`)));
    expect(linked.map((a) => a.userId)).toEqual([u.id]);
    const r = await row(u.id);
    expect(r.passwordHash).toBeNull();
    expect(r.emailVerified).toBeInstanceOf(Date);
    expect(r.passwordChangedAt).toBeInstanceOf(Date);
    expect(await db.select().from(schema.movilLlaves).where(eq(schema.movilLlaves.userId, u.id))).toEqual([]);
  });

  it("a verified account stays as it was", async () => {
    const u = await user({ verified: true });
    expect(await cederAGoogle({ email: u.email, providerAccountId: `g-${u.id}`, type: "oidc" })).toBe(false);
    expect((await row(u.id)).passwordHash).toBe("squatter");
  });

  it("an account that already has a Google account stays as it was", async () => {
    const u = await user({ google: true });
    expect(await cederAGoogle({ email: u.email, providerAccountId: `g-${u.id}`, type: "oidc" })).toBe(false);
    expect((await row(u.id)).passwordHash).toBe("squatter");
  });

  it("no account with that email: nothing to do", async () => {
    expect(await cederAGoogle({ email: `nobody-${crypto.randomUUID()}@openlen.test`, providerAccountId: "g-x", type: "oidc" })).toBe(false);
  });
});
