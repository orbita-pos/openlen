// @vitest-environment node
//
// The wiring: auth.ts's signIn callback hands a Google sign-in with a VERIFIED email to cederAGoogle
// before Auth.js decides about linking (it looks the Google account up again afterwards). Anything else
// signs in as before.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ceder = vi.fn<(p: unknown) => Promise<boolean>>();
vi.mock("@/lib/auth/google-takeover", () => ({ cederAGoogle: (p: unknown) => ceder(p) }));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("next-auth/providers/credentials", () => ({ default: (o: object) => ({ id: "credentials", ...o }) }));
vi.mock("next-auth/providers/google", () => ({ default: (o: object) => ({ id: "google", ...o }) }));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));

import { config } from "@/auth";

type SignIn = (p: { user: unknown; account: Record<string, unknown> | null; profile?: Record<string, unknown> }) => Promise<boolean | string>;
const signIn = config.callbacks!.signIn as unknown as SignIn;

describe("🔴 auth.ts lets Google take over an unverified sign-up", () => {
  beforeEach(() => {
    ceder.mockReset();
    ceder.mockResolvedValue(true);
  });

  it("Google with a verified email: hands it over, then signs in", async () => {
    const r = await signIn({ user: {}, account: { provider: "google", type: "oidc", providerAccountId: "g1" }, profile: { email: "Ana@x.test", email_verified: true } });
    expect(r).toBe(true);
    expect(ceder).toHaveBeenCalledWith({ email: "Ana@x.test", providerAccountId: "g1", type: "oidc" });
  });

  it("Google without a verified email, or a password sign-in: nothing handed over", async () => {
    await signIn({ user: {}, account: { provider: "google", type: "oidc", providerAccountId: "g1" }, profile: { email: "ana@x.test", email_verified: false } });
    await signIn({ user: {}, account: { provider: "credentials", type: "credentials", providerAccountId: "u1" } });
    expect(ceder).not.toHaveBeenCalled();
  });

  it("if handing over fails, the sign-in goes on as Auth.js decides", async () => {
    ceder.mockRejectedValue(new Error("db down"));
    const r = await signIn({ user: {}, account: { provider: "google", type: "oidc", providerAccountId: "g1" }, profile: { email: "ana@x.test", email_verified: true } });
    expect(r).toBe(true);
  });
});
