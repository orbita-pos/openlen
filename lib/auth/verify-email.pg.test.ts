// @vitest-environment node
//
// Confirming the email after signing up (2026-10-21, «sin bloquear»): the account works from the first
// moment; the emailed link marks the address as verified. Against a real Postgres; skipped without one.
import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, schema } from "@/lib/db";

import { correoPorConfirmar, crearVerificacionDelCorreo, enlaceDeVerificacion, verificarCorreo } from "./verify-email";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const userId = crypto.randomUUID();
const email = `verify-${userId}@openlen.test`;
const verified = async () => (await db.select({ at: schema.users.emailVerified }).from(schema.users).where(eq(schema.users.id, userId)))[0]!.at;

describe.skipIf(!HAS_DB)("🔴 verifying the email", () => {
  beforeAll(async () => {
    await db.insert(schema.users).values({ id: userId, email, passwordHash: "x" });
  });
  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.verificationTokens).where(eq(schema.verificationTokens.identifier, `verify:${email}`));
  });

  it("a wrong or an expired link verifies nothing", async () => {
    expect(await verificarCorreo("x".repeat(43))).toBe(false);
    const raw = await crearVerificacionDelCorreo(email);
    expect(await verificarCorreo(raw, new Date(Date.now() + 25 * 60 * 60_000))).toBe(false);
    expect(await verified()).toBeNull();
  });

  it("the emailed link marks the address verified, once; only the token's hash is stored", async () => {
    const raw = await crearVerificacionDelCorreo(email);
    const rows = await db.select().from(schema.verificationTokens).where(eq(schema.verificationTokens.identifier, `verify:${email}`));
    expect(rows.some((r) => r.token === raw)).toBe(false);
    expect(await verificarCorreo(raw)).toBe(true);
    expect(await verified()).toBeInstanceOf(Date);
    expect(await verificarCorreo(raw)).toBe(false);
  });

  it("a new link replaces the one before: only the last email works", async () => {
    const first = await crearVerificacionDelCorreo(email);
    const second = await crearVerificacionDelCorreo(email);
    expect(await verificarCorreo(first)).toBe(false);
    expect(await verificarCorreo(second)).toBe(true);
  });

  it("the link is built from the server's address, never the request's", () => {
    const before = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://openlen.com";
    try {
      expect(enlaceDeVerificacion("T0K3N")).toBe("https://openlen.com/verificar/T0K3N");
    } finally {
      if (before === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = before;
    }
  });
});

describe.skipIf(!HAS_DB)("🔴 whose email is still to confirm", () => {
  const ids = { password: crypto.randomUUID(), verified: crypto.randomUUID(), google: crypto.randomUUID() };
  const mail = (id: string) => `pending-${id}@openlen.test`;
  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: ids.password, email: mail(ids.password), passwordHash: "x" },
      { id: ids.verified, email: mail(ids.verified), passwordHash: "x", emailVerified: new Date() },
      { id: ids.google, email: mail(ids.google) },
    ]);
  });
  afterAll(async () => {
    for (const id of Object.values(ids)) await db.delete(schema.users).where(eq(schema.users.id, id));
  });

  it("an account with a password and no confirmation has its email to confirm", async () => {
    expect(await correoPorConfirmar(ids.password)).toBe(mail(ids.password));
  });

  it("a confirmed account, a Google one (no password) or a missing one has none", async () => {
    expect(await correoPorConfirmar(ids.verified)).toBeNull();
    expect(await correoPorConfirmar(ids.google)).toBeNull();
    expect(await correoPorConfirmar(crypto.randomUUID())).toBeNull();
  });
});
