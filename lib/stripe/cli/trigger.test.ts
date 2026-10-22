import { describe, expect, it, vi } from "vitest";

import type { StripeRequest, StripeResponse } from "../api";
import { fixtureForm, runTrigger, TRIGGER_EVENTS } from "./trigger";

const ok = (body: unknown): StripeResponse => ({ status: 200, text: JSON.stringify(body), json: body, requestId: null });

describe("fixtureForm", () => {
  it("encodes params like the CLI's parsers: maps nest, string arrays take [], object arrays take an index", () => {
    expect(
      fixtureForm({ a: "x", n: 1500, b: true, m: { k: "v" }, s: ["one", "two"], o: [{ price: "${price:id}", quantity: 2 }] }, { price: { id: "price_9" } }),
    ).toEqual([["a", "x"], ["n", "1500"], ["b", "true"], ["m[k]", "v"], ["s[]", "one"], ["s[]", "two"], ["o[0][price]", "price_9"], ["o[0][quantity]", "2"]]);
  });
});

describe("runTrigger", () => {
  it("runs the fixture's steps in order and fills ${name:path} from earlier answers", async () => {
    const answers: Record<string, unknown> = {
      "POST /v1/products": { id: "prod_9" },
      "POST /v1/prices": { id: "price_9" },
      "POST /v1/checkout/sessions": { id: "cs_test_9" },
    };
    const request = vi.fn(async (_k: string, req: StripeRequest) => ok(answers[`${req.method} ${req.path}`] ?? { id: "x" }));
    const r = await runTrigger("checkout.session.completed", "sk_test_d", request);
    const calls = request.mock.calls.map(([, req]) => `${req.method} ${req.path}`);
    expect(calls.slice(0, 4)).toEqual(["POST /v1/products", "POST /v1/prices", "POST /v1/checkout/sessions", "GET /v1/payment_pages/cs_test_9"]);
    expect(decodeURIComponent(request.mock.calls[1]![1].form!)).toContain("product=prod_9");
    expect(r.exitCode).toBe(0);
  });

  it("prints what the CLI prints", async () => {
    const r = await runTrigger("payment_intent.succeeded", "sk_test_d", async () => ok({ id: "pi_1" }));
    expect(r.stdout).toMatch(/^Setting up fixture for: \w+\nRunning fixture for: \w+\n/);
    expect(r.stdout.endsWith("Trigger succeeded! Check dashboard for event details.\n")).toBe(true);
  });

  it("an unknown event lists the supported ones", async () => {
    const request = vi.fn();
    const r = await runTrigger("nope.event", "sk_test_d", request);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("checkout.session.completed");
    expect(request).not.toHaveBeenCalled();
  });

  it("a failing step stops and says which, like the CLI", async () => {
    const request = vi.fn(async (_k: string, req: StripeRequest): Promise<StripeResponse> =>
      req.path === "/v1/prices" ? { status: 400, text: '{"error":{"message":"bad"}}', json: { error: { message: "bad" } }, requestId: null } : ok({ id: "prod_9" }),
    );
    const r = await runTrigger("checkout.session.completed", "sk_test_d", request);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("Running fixture for: price\n");
    expect(r.stdout).toContain('Error: Request failed, status=400, body={"error":{"message":"bad"}}');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("an expected error doesn't stop the fixture (payment_intent.payment_failed)", async () => {
    const request = vi.fn(async (): Promise<StripeResponse> => ({ status: 402, text: '{"error":{"type":"card_error"}}', json: { error: { type: "card_error" } }, requestId: null }));
    const r = await runTrigger("payment_intent.payment_failed", "sk_test_d", request);
    expect(r.exitCode).toBe(0);
  });

  it("supports the events of the plan", () => {
    expect(TRIGGER_EVENTS).toEqual([
      "checkout.session.completed", "checkout.session.expired", "payment_intent.succeeded", "payment_intent.payment_failed",
      "charge.refunded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
      "invoice.paid", "invoice.payment_failed",
    ]);
  });
});
