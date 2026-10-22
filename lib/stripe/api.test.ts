import { describe, expect, it, vi } from "vitest";

import { encodeStripeParams, StripeApiError, stripeCall, stripeRequest } from "./api";

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("encodeStripeParams", () => {
  it("encodes nested params the way Stripe expects", () => {
    expect(
      encodeStripeParams({ name: "Curso", line_items: [{ price: "price_1", quantity: 1 }], recurring: { interval: "month" }, active: true, skip: undefined }),
    ).toBe("name=Curso&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&recurring%5Binterval%5D=month&active=true");
  });

  it("skips null and encodes false", () => {
    expect(encodeStripeParams({ a: null, b: false, c: "x y" })).toBe("b=false&c=x+y");
  });
});

describe("stripeRequest", () => {
  it("sends the key, the pinned version and the idempotency key", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok({ id: "prod_1" }, { "request-id": "req_1" }));
    const r = await stripeRequest("sk_test_x", { method: "POST", path: "/v1/products", form: "name=A", idempotencyKey: "k1" }, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/products");
    const h = new Headers(init!.headers);
    expect(h.get("authorization")).toBe("Bearer sk_test_x");
    expect(h.get("stripe-version")).toBe("2026-09-30.endive");
    expect(h.get("idempotency-key")).toBe("k1");
    expect(h.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(init!.body).toBe("name=A");
    expect(r).toMatchObject({ status: 200, json: { id: "prod_1" }, requestId: "req_1" });
  });

  it("puts GET params in the query string", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok({ data: [] }));
    await stripeRequest("sk_test_x", { method: "GET", path: "/v1/products", form: "limit=1" }, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/products?limit=1");
    expect(init!.body).toBeUndefined();
  });

  it("keeps a body that isn't JSON as text", async () => {
    const f = vi.fn(async () => new Response("gateway down", { status: 502 }));
    const r = await stripeRequest("sk_test_x", { method: "GET", path: "/v1/balance" }, f as unknown as typeof fetch);
    expect(r).toMatchObject({ status: 502, text: "gateway down", json: null, requestId: null });
  });
});

describe("stripeCall", () => {
  it("returns the parsed body on 2xx", async () => {
    const f = vi.fn(async () => ok({ id: "prod_1" }));
    await expect(stripeCall<{ id: string }>("sk_test_x", "POST", "/v1/products", { name: "A" }, { f: f as unknown as typeof fetch })).resolves.toEqual({ id: "prod_1" });
  });

  it("throws StripeApiError with Stripe's error fields", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing", message: "No such price" } }), {
          status: 400,
          headers: { "request-id": "req_9" },
        }),
    );
    const e = await stripeCall("sk_test_x", "GET", "/v1/prices/price_x", undefined, { f: f as unknown as typeof fetch }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StripeApiError);
    expect(e).toMatchObject({ status: 400, type: "invalid_request_error", code: "resource_missing", message: "No such price", requestId: "req_9" });
  });
});
