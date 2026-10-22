import { describe, expect, it, vi } from "vitest";

import type { StripeEnv } from "./api";
import { checkStripeKey, stripeKeyShape } from "./key-check";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("stripeKeyShape", () => {
  it.each([
    ["sk_test_abc123", { kind: "sk", livemode: false }],
    ["rk_live_abc123", { kind: "rk", livemode: true }],
    ["pk_test_abc123", { kind: "pk", livemode: false }],
    ["whsec_abc1234567", { kind: "whsec", livemode: null }],
    ["hola", { kind: null, livemode: null }],
  ])("%s", (value, shape) => {
    expect(stripeKeyShape(value)).toEqual(shape);
  });
});

describe("checkStripeKey", () => {
  it.each([
    ["pk_test_abc123", "draft", "publishable_key"],
    ["whsec_abc1234567", "draft", "webhook_secret"],
    ["hola", "draft", "not_a_stripe_key"],
    ["sk_live_abc123", "draft", "live_in_draft"],
    ["rk_test_abc123", "live", "test_in_live"],
  ])("rejects %s for %s before calling Stripe", async (value, env, problem) => {
    const f = vi.fn();
    expect(await checkStripeKey(value, env as StripeEnv, f as unknown as typeof fetch)).toEqual({ ok: false, problem });
    expect(f).not.toHaveBeenCalled();
  });

  it("reads the account with GET /v1/account", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      json(200, { id: "acct_1", settings: { dashboard: { display_name: "Taller" } }, charges_enabled: false }),
    );
    expect(await checkStripeKey(" sk_test_abc123\n", "draft", f as unknown as typeof fetch)).toEqual({
      ok: true,
      account: { accountId: "acct_1", accountName: "Taller", keyKind: "sk", livemode: false, chargesEnabled: false },
    });
    expect(String(f.mock.calls[0]![0])).toBe("https://api.stripe.com/v1/account");
    expect(new Headers(f.mock.calls[0]![1]!.headers).get("authorization")).toBe("Bearer sk_test_abc123");
  });

  it("falls back to the business profile's name", async () => {
    const f = vi.fn(async () => json(200, { id: "acct_2", business_profile: { name: "Cerámica" }, charges_enabled: true }));
    expect(await checkStripeKey("sk_live_abc123", "live", f as unknown as typeof fetch)).toMatchObject({
      ok: true,
      account: { accountId: "acct_2", accountName: "Cerámica", livemode: true, chargesEnabled: true },
    });
  });

  it("takes a 403 as a good restricted key and reads the account from Stripe's message", async () => {
    const f = vi.fn(async () =>
      json(403, {
        error: {
          type: "invalid_request_error",
          message: "The provided key 'rk_test_***abc' does not have the required permissions for this endpoint on account 'acct_9'.",
        },
      }),
    );
    expect(await checkStripeKey("rk_test_abc123", "draft", f as unknown as typeof fetch)).toEqual({
      ok: true,
      account: { accountId: "acct_9", accountName: null, keyKind: "rk", livemode: false, chargesEnabled: null },
    });
  });

  it("a 403 that names no account keeps the key with an unknown account", async () => {
    const f = vi.fn(async () => json(403, { error: { message: "The provided key does not have the required permissions." } }));
    expect(await checkStripeKey("rk_test_abc123", "draft", f as unknown as typeof fetch)).toMatchObject({ ok: true, account: { accountId: "unknown" } });
  });

  it("401 → rejected_by_stripe", async () => {
    const f = vi.fn(async () => json(401, { error: { message: "Invalid API Key provided" } }));
    expect(await checkStripeKey("sk_test_abc123", "draft", f as unknown as typeof fetch)).toEqual({ ok: false, problem: "rejected_by_stripe" });
  });

  it("network failure → unverified", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkStripeKey("sk_test_abc123", "draft", f as unknown as typeof fetch)).toEqual({ ok: "unverified", keyKind: "sk", livemode: false });
  });

  it("a 5xx is unverified too, not a rejection", async () => {
    const f = vi.fn(async () => new Response("oops", { status: 503 }));
    expect(await checkStripeKey("sk_test_abc123", "draft", f as unknown as typeof fetch)).toEqual({ ok: "unverified", keyKind: "sk", livemode: false });
  });
});
