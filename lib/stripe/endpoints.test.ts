import { describe, expect, it, vi } from "vitest";

import { deleteProjectEndpoints } from "./endpoints";
import { memoryStripeStore } from "./store";

async function setup() {
  const store = memoryStripeStore();
  await store.recordTestObject({ projectId: "p", kind: "webhook_endpoint", testId: "we_t1", source: "cli", secretName: "STRIPE_WEBHOOK_SECRET" });
  await store.recordTestObject({ projectId: "p", kind: "webhook_endpoint", testId: "we_t2", source: "cli", secretName: "STRIPE_WEBHOOK_SECRET_PAGO" });
  await store.setTwin("p", "we_t1", { liveId: "we_l1", fingerprint: "f" });
  await store.recordTestObject({ projectId: "p", kind: "product", testId: "curso", source: "cli" });
  await store.setTwin("p", "curso", { liveId: "curso", fingerprint: "f" });
  const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response("{}", { status: 200 }));
  return { store, f };
}

describe("deleteProjectEndpoints", () => {
  it("draft: deletes the test endpoints with the draft key, forgets them and returns their secrets", async () => {
    const { store, f } = await setup();
    const names = await deleteProjectEndpoints("p", "draft", { store, keyFor: async () => "sk_test_x", f: f as unknown as typeof fetch });
    expect(names).toEqual(["STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_PAGO"]);
    expect(f.mock.calls.map(([u, i]) => `${i!.method} ${String(u)}`)).toEqual([
      "DELETE https://api.stripe.com/v1/webhook_endpoints/we_t1",
      "DELETE https://api.stripe.com/v1/webhook_endpoints/we_t2",
    ]);
    expect((await store.listObjects("p")).map((r) => r.testId)).toEqual(["curso"]);
  });

  it("live: deletes the live twins, clears them, keeps the product twins", async () => {
    const { store, f } = await setup();
    const names = await deleteProjectEndpoints("p", "live", { store, keyFor: async () => "sk_live_x", f: f as unknown as typeof fetch });
    expect(names).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(f.mock.calls.map(([u]) => String(u))).toEqual(["https://api.stripe.com/v1/webhook_endpoints/we_l1"]);
    const rows = await store.listObjects("p");
    expect(rows.find((r) => r.testId === "we_t1")).toMatchObject({ liveId: null });
    expect(rows.find((r) => r.testId === "curso")).toMatchObject({ liveId: "curso" });
  });

  it("a Stripe error on one endpoint doesn't stop the others; without a key nothing is called", async () => {
    const { store } = await setup();
    const f = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 })).mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await deleteProjectEndpoints("p", "draft", { store, keyFor: async () => "sk_test_x", f: f as unknown as typeof fetch })).toHaveLength(2);
    const fresh = await setup();
    const g = vi.fn();
    expect(await deleteProjectEndpoints("p", "live", { store: fresh.store, keyFor: async () => null, f: g as unknown as typeof fetch })).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(g).not.toHaveBeenCalled();
  });
});
