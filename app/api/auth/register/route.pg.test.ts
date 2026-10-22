// @vitest-environment node
//
// Signing up sends the email that confirms the address (2026-10-21, «sin bloquear»): the account works
// at once, and the link in the email marks it verified. If the email can't go, signing up still works.
// Against a real Postgres; skipped without one.
import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendVerificationEmail: (i: unknown) => sent.fn(i) }));

import { db, schema } from "@/lib/db";
import { verificarCorreo } from "@/lib/auth/verify-email";

import { POST } from "./route";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const emails: string[] = [];
const register = (email: string) =>
  POST(new Request("http://localhost/api/auth/register", { method: "POST", headers: { "x-forwarded-for": `10.9.${emails.length}.1` }, body: JSON.stringify({ email, password: "a good password" }) }));

describe.skipIf(!HAS_DB)("🔴 POST /api/auth/register sends the confirmation email", () => {
  // A block, not an arrow that returns: what beforeEach returns, vitest calls after the test.
  beforeEach(() => {
    sent.fn.mockReset();
  });
  afterAll(async () => {
    for (const e of emails) await db.delete(schema.users).where(eq(schema.users.email, e));
  });

  it("the account is created unverified, and the emailed link verifies it", async () => {
    const email = `register-${crypto.randomUUID()}@openlen.test`;
    emails.push(email);
    sent.fn.mockResolvedValue(undefined);
    expect((await register(email)).status).toBe(200);
    expect(sent.fn).toHaveBeenCalledTimes(1);
    const { to, verifyUrl } = sent.fn.mock.calls[0]![0] as { to: string; verifyUrl: string };
    expect(to).toBe(email);
    const [u] = await db.select({ at: schema.users.emailVerified }).from(schema.users).where(eq(schema.users.email, email));
    expect(u!.at).toBeNull();
    expect(await verificarCorreo(verifyUrl.split("/verificar/")[1]!)).toBe(true);
  });

  it("if the email can't be sent, signing up still works", async () => {
    const email = `register-${crypto.randomUUID()}@openlen.test`;
    emails.push(email);
    sent.fn.mockRejectedValue(new Error("resend down"));
    expect((await register(email)).status).toBe(200);
  });
});
