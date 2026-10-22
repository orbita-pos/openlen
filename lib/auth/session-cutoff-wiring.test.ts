// @vitest-environment node
//
// The wiring: Auth.js's own jwt callback (auth.ts) ends the session when the cutoff says so. Returning
// null there is Auth.js's way to say «no session»: it clears the cookie (@auth/core, actions/session.js).
import { beforeEach, describe, expect, it, vi } from "vitest";

const stillValid = vi.fn<(token: unknown) => Promise<boolean>>();
vi.mock("@/lib/auth/session-cutoff", () => ({ passwordCutoff: { stillValid: (t: unknown) => stillValid(t), forget: vi.fn() } }));
// next-auth itself doesn't load under vitest (it imports `next/server` the way only Next resolves); what
// is tested is OUR config object, which auth.ts hands to NextAuth.
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("next-auth/providers/credentials", () => ({ default: (o: object) => ({ id: "credentials", ...o }) }));
vi.mock("next-auth/providers/google", () => ({ default: (o: object) => ({ id: "google", ...o }) }));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));

import { config } from "@/auth";

type JwtCallback = (p: { token: Record<string, unknown>; user?: unknown; trigger?: string }) => Promise<Record<string, unknown> | null>;
const jwt = config.callbacks!.jwt as unknown as JwtCallback;

describe("🔴 auth.ts ends a session the password reset closed", () => {
  beforeEach(() => stillValid.mockReset());

  it("a session from before the reset gets no token, so no session", async () => {
    stillValid.mockResolvedValue(false);
    expect(await jwt({ token: { sub: "u1", authAt: 1 } })).toBeNull();
  });

  it("a valid one goes on as it was", async () => {
    stillValid.mockResolvedValue(true);
    expect(await jwt({ token: { sub: "u1", authAt: 1, name: "Ana" } })).toEqual({ sub: "u1", authAt: 1, name: "Ana" });
  });
});
