// @vitest-environment node
//
// A password reset closes the sessions already open (2026-10-21). Sessions are JWTs of 30 days that the
// server can't delete, so each one carries when it signed in (`authAt`) and the server compares it with
// the account's `passwordChangedAt`: a session from before the change is no session.
import { describe, expect, it, vi } from "vitest";

import authConfig from "@/auth.config";

import { sessionCutoff } from "./session-cutoff";

const CHANGED = new Date("2026-10-21T12:00:00Z");
const before = { sub: "u1", authAt: CHANGED.getTime() - 1 };
const after = { sub: "u1", authAt: CHANGED.getTime() + 1 };

describe("🔴 sessionCutoff", () => {
  it("a session signed in before the password changed is no longer valid; one after it is", async () => {
    const cut = sessionCutoff(async () => CHANGED);
    expect(await cut.stillValid(before)).toBe(false);
    expect(await cut.stillValid(after)).toBe(true);
  });

  it("an account whose password never changed keeps every session", async () => {
    const cut = sessionCutoff(async () => null);
    expect(await cut.stillValid(before)).toBe(true);
  });

  it("a session from before this existed (no authAt) closes once the password changes", async () => {
    expect(await sessionCutoff(async () => CHANGED).stillValid({ sub: "u1" })).toBe(false);
    expect(await sessionCutoff(async () => null).stillValid({ sub: "u1" })).toBe(true);
  });

  it("asks the database at most once a minute per account, and forget() asks again at once", async () => {
    let now = 0;
    const read = vi.fn(async () => null as Date | null);
    const cut = sessionCutoff(read, { now: () => now });
    await cut.stillValid(after);
    now = 59_000;
    await cut.stillValid(after);
    expect(read).toHaveBeenCalledTimes(1);
    now = 61_000;
    await cut.stillValid(after);
    expect(read).toHaveBeenCalledTimes(2);
    cut.forget("u1");
    await cut.stillValid(after);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("if the database can't answer, the session stands: signing in must not depend on it", async () => {
    const cut = sessionCutoff(async () => {
      throw new Error('column "passwordChangedAt" does not exist');
    });
    expect(await cut.stillValid(before)).toBe(true);
  });
});

describe("🔴 the session's token says when it signed in", () => {
  it("signing in stamps authAt; a later read of the session keeps it", async () => {
    const jwt = authConfig.callbacks.jwt as (p: { token: Record<string, unknown>; user?: { id: string } }) => Promise<Record<string, unknown>>;
    const signedIn = await jwt({ token: {}, user: { id: "u1" } });
    expect(signedIn.sub).toBe("u1");
    expect(typeof signedIn.authAt).toBe("number");
    expect(await jwt({ token: { ...signedIn } })).toEqual(signedIn);
  });
});
