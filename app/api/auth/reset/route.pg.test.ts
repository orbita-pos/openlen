// @vitest-environment node
//
// The reset closes the sessions already open (2026-10-21): it stamps `passwordChangedAt`, which every
// session read compares with when that session signed in (lib/auth/session-cutoff.ts), and it drops the
// phone app's keys, which are sessions too. Against a real Postgres (DATABASE_URL); skipped without one.
import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, schema } from "@/lib/db";
import { sessionCutoff } from "@/lib/auth/session-cutoff";

import { POST } from "./route";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const userId = crypto.randomUUID();
const raw = crypto.randomBytes(32).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

describe.skipIf(!HAS_DB)("🔴 POST /api/auth/reset closes the sessions already open", () => {
  beforeAll(async () => {
    await db.insert(schema.users).values({ id: userId, email: `reset-${userId}@openlen.test`, passwordHash: "old" });
    await db.insert(schema.passwordResetTokens).values({ tokenHash: sha256(raw), userId, expires: new Date(Date.now() + 60_000), used: false });
    await db.insert(schema.movilLlaves).values({ huella: sha256(`phone-${userId}`), userId, nombre: "phone" });
  });
  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("stamps when the password changed, so a session from before it is no longer valid, and drops the phone's keys", async () => {
    const signedInBefore = Date.now() - 1_000;
    const res = await POST(new Request("http://localhost/api/auth/reset", { method: "POST", body: JSON.stringify({ token: raw, password: "a new password" }) }));
    expect(res.status).toBe(200);
    const [user] = await db.select({ at: schema.users.passwordChangedAt }).from(schema.users).where(eq(schema.users.id, userId));
    expect(user!.at).toBeInstanceOf(Date);
    const cut = sessionCutoff(async () => user!.at);
    expect(await cut.stillValid({ sub: userId, authAt: signedInBefore })).toBe(false);
    expect(await cut.stillValid({ sub: userId, authAt: Date.now() })).toBe(true);
    expect(await db.select().from(schema.movilLlaves).where(eq(schema.movilLlaves.userId, userId))).toEqual([]);
  });
});
