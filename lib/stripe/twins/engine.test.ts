import { describe, expect, it, vi } from "vitest";

import { stripeCall } from "../api";
import { memoryStripeStore } from "../store";
import { fakeStripe } from "./fake-stripe";
import { applyTwins, planTwins, type TwinsDeps } from "./engine";

const TEST = "sk_test_x";
const LIVE = "sk_live_x";
const DRAFT_FN = "https://draftrefdraftrefdraf.openlen.app/functions/v1/";
const LIVE_FN = "https://liverefliverefliveref.openlen.app/functions/v1/";

async function world() {
  const stripe = fakeStripe();
  const store = memoryStripeStore();
  const f = stripe.fetch;
  const t = <T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>) => stripeCall<T>(TEST, method, path, params, { f });
  const deps: TwinsDeps = {
    store,
    testKey: TEST,
    liveKey: LIVE,
    functionUrls: { draft: DRAFT_FN, live: LIVE_FN },
    liveFunctions: ["pago"],
    canvasHost: "lienzo.openlen.app",
    f,
  };
  // What Len made with the `stripe` command: a product with its own id, a price by lookup key, a payment link.
  async function curso() {
    await t("POST", "/v1/products", { id: "curso", name: "Curso de cerámica", images: ["https://uploads.openlen.com/a.jpg", "https://p1.lienzo.openlen.app/b.jpg"] });
    const price = await t<{ id: string }>("POST", "/v1/prices", { product: "curso", unit_amount: 2900, currency: "usd", lookup_key: "curso" });
    const link = await t<{ id: string; url: string }>("POST", "/v1/payment_links", { line_items: [{ price: price.id, quantity: 1 }] });
    await store.recordTestObject({ projectId: "p", kind: "product", testId: "curso", source: "cli" });
    await store.recordTestObject({ projectId: "p", kind: "price", testId: price.id, source: "cli", lookupKey: "curso" });
    await store.recordTestObject({ projectId: "p", kind: "payment_link", testId: link.id, source: "cli", testUrl: link.url });
    return { price, link };
  }
  return { stripe, store, deps, t, curso };
}

describe("planTwins", () => {
  it("counts what will be created and never writes", async () => {
    const w = await world();
    const { link } = await w.curso();
    const plan = await planTwins("p", [`<a href="${link.url}">Comprar</a>`], w.deps);
    expect(plan.create).toEqual({ products: 1, prices: 1, paymentLinks: 1, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 });
    expect(plan.swaps).toBe(1);
    expect(plan.needsWrites).toBe(true);
    expect(plan.droppedImages).toBe(1);
    expect(plan.chargesEnabled).toBe(true);
    expect(w.stripe.liveWrites()).toBe(0);
  });

  it("an id in the files that exists in neither mode is reported, not copied", async () => {
    const w = await world();
    const plan = await planTwins("p", ["price_1QnotThereAtAll00"], w.deps);
    expect(plan.unknownRefs).toEqual(["price_1QnotThereAtAll00"]);
    expect(plan.needsWrites).toBe(false);
  });

  it("an id that already is a live one is left alone", async () => {
    const w = await world();
    w.stripe.seed("live", { id: "price_1QliveAlready000", object: "price" });
    const plan = await planTwins("p", ["price_1QliveAlready000"], w.deps);
    expect(plan.unknownRefs).toEqual([]);
    expect(plan.swaps).toBe(0);
  });
});

describe("applyTwins", () => {
  it("copies the product with the same id, the price by lookup_key, and the link with the live price", async () => {
    const w = await world();
    const { price, link } = await w.curso();
    const map = await applyTwins("p", [link.url], w.deps, vi.fn());
    const liveProduct = w.stripe.get("live", "curso")!;
    expect(liveProduct).toMatchObject({ name: "Curso de cerámica", images: ["https://uploads.openlen.com/a.jpg"] });
    const [livePrice] = w.stripe.all("live", "price");
    expect(livePrice).toMatchObject({ product: "curso", unit_amount: 2900, currency: "usd", lookup_key: "curso" });
    const [liveLink] = w.stripe.all("live", "payment_link");
    expect((liveLink!.line_items_data as { price: string }[])[0]!.price).toBe(livePrice!.id);
    expect(map.get(price.id)).toBe(livePrice!.id);
    expect(map.get(link.url)).toBe(liveLink!.url);
    expect((await w.store.listObjects("p")).every((r) => r.liveId)).toBe(true);
  });

  it("Real test 22/10: a link with one-time prices is copied without the payment_method_collection Stripe returns on it", async () => {
    const w = await world();
    const { link } = await w.curso();
    expect(w.stripe.get("test", link.id)).toMatchObject({ payment_method_collection: "if_required" });
    await applyTwins("p", [link.url], w.deps, vi.fn());
    expect(w.stripe.all("live", "payment_link")).toHaveLength(1);
  });

  it("a link with a recurring price keeps its payment_method_collection", async () => {
    const w = await world();
    await w.t("POST", "/v1/products", { id: "club", name: "Club" });
    const price = await w.t<{ id: string }>("POST", "/v1/prices", { product: "club", unit_amount: 900, currency: "usd", recurring: { interval: "month" } });
    const link = await w.t<{ id: string; url: string }>("POST", "/v1/payment_links", { line_items: [{ price: price.id, quantity: 1 }], payment_method_collection: "always" });
    await w.store.recordTestObject({ projectId: "p", kind: "payment_link", testId: link.id, source: "cli", testUrl: link.url });
    await applyTwins("p", [link.url], w.deps, vi.fn());
    expect(w.stripe.all("live", "payment_link")[0]).toMatchObject({ payment_method_collection: "always" });
  });

  it("a second apply creates nothing", async () => {
    const w = await world();
    const { link } = await w.curso();
    await applyTwins("p", [link.url], w.deps, vi.fn());
    const before = w.stripe.liveWrites();
    await applyTwins("p", [link.url], w.deps, vi.fn());
    expect(w.stripe.liveWrites()).toBe(before);
  });

  it("Review 1: a 429 on the third write refuses, keeps the twins made, and the retry finishes without duplicates", async () => {
    const w = await world();
    const { link } = await w.curso();
    w.stripe.failWrite(w.stripe.calls.filter((c) => !c.includes(" GET ")).length + 3);
    await expect(applyTwins("p", [link.url], w.deps, vi.fn())).rejects.toMatchObject({ status: 429 });
    expect((await w.store.listObjects("p")).filter((r) => r.liveId).map((r) => r.kind)).toEqual(["product", "price"]);
    await applyTwins("p", [link.url], w.deps, vi.fn());
    expect(w.stripe.all("live", "product")).toHaveLength(1);
    expect(w.stripe.all("live", "price")).toHaveLength(1);
    expect(w.stripe.all("live", "payment_link")).toHaveLength(1);
  });

  it("Review 3: a live product with the same id is updated, not duplicated", async () => {
    const w = await world();
    w.stripe.seed("live", { id: "curso", object: "product", name: "Viejo" });
    const { link } = await w.curso();
    await applyTwins("p", [link.url], w.deps, vi.fn());
    expect(w.stripe.all("live", "product")).toHaveLength(1);
    expect(w.stripe.get("live", "curso")).toMatchObject({ name: "Curso de cerámica" });
  });

  it("Review 4: a changed price gets a new live price and the lookup key moves to it", async () => {
    const w = await world();
    const { link } = await w.curso();
    await applyTwins("p", [link.url], w.deps, vi.fn());
    const second = await w.t<{ id: string }>("POST", "/v1/prices", { product: "curso", unit_amount: 3500, currency: "usd", lookup_key: "curso", transfer_lookup_key: true });
    await w.store.recordTestObject({ projectId: "p", kind: "price", testId: second.id, source: "cli", lookupKey: "curso" });
    const map = await applyTwins("p", [second.id], w.deps, vi.fn());
    const prices = w.stripe.all("live", "price");
    expect(prices).toHaveLength(2);
    const now = prices.find((p) => p.lookup_key === "curso")!;
    expect(now.unit_amount).toBe(3500);
    expect(map.get(second.id)).toBe(now.id);
    expect(w.stripe.calls.some((c) => c === "live POST /v1/prices")).toBe(true);
  });

  it("reuses a live price with the same lookup key and the same terms", async () => {
    const w = await world();
    w.stripe.seed("live", { id: "curso", object: "product", name: "Curso" });
    w.stripe.seed("live", { id: "price_Lexisting00000000", object: "price", product: "curso", unit_amount: 2900, currency: "usd", lookup_key: "curso", recurring: null });
    const { price } = await w.curso();
    const map = await applyTwins("p", [], w.deps, vi.fn());
    expect(map.get(price.id)).toBe("price_Lexisting00000000");
    expect(w.stripe.all("live", "price")).toHaveLength(1);
  });

  it("an endpoint is copied to the live function URL with its events and its secret saved for live", async () => {
    const w = await world();
    const ep = await w.t<{ id: string; url: string }>("POST", "/v1/webhook_endpoints", { url: `${DRAFT_FN}pago`, enabled_events: ["checkout.session.completed"] });
    await w.store.recordTestObject({ projectId: "p", kind: "webhook_endpoint", testId: ep.id, source: "cli", testUrl: ep.url, functionName: "pago", secretName: "STRIPE_WEBHOOK_SECRET" });
    const save = vi.fn(async () => {});
    await applyTwins("p", [], w.deps, save);
    const [live] = w.stripe.all("live", "webhook_endpoint");
    expect(live).toMatchObject({ url: `${LIVE_FN}pago`, enabled_events: ["checkout.session.completed"] });
    expect(save).toHaveBeenCalledWith("STRIPE_WEBHOOK_SECRET", live!.secret);
  });

  it("an endpoint for a function that isn't in the live bundle is not copied", async () => {
    const w = await world();
    const ep = await w.t<{ id: string; url: string }>("POST", "/v1/webhook_endpoints", { url: `${DRAFT_FN}otra`, enabled_events: ["charge.refunded"] });
    await w.store.recordTestObject({ projectId: "p", kind: "webhook_endpoint", testId: ep.id, source: "cli", testUrl: ep.url, functionName: "otra" });
    await applyTwins("p", [], w.deps, vi.fn());
    expect(w.stripe.all("live", "webhook_endpoint")).toHaveLength(0);
  });

  it("a payment link made in the dashboard and named in the files is found by its URL, with its price", async () => {
    const w = await world();
    const product = await w.t<{ id: string }>("POST", "/v1/products", { name: "Taza" });
    const price = await w.t<{ id: string }>("POST", "/v1/prices", { product: product.id, unit_amount: 1500, currency: "mxn" });
    const link = await w.t<{ url: string }>("POST", "/v1/payment_links", { line_items: [{ price: price.id, quantity: 1 }] });
    const map = await applyTwins("p", [`<a href="${link.url}">`], w.deps, vi.fn());
    expect(map.get(link.url)).toMatch(/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/);
    expect(w.stripe.all("live", "price")[0]).toMatchObject({ unit_amount: 1500, currency: "mxn" });
    expect((await w.store.listObjects("p")).map((r) => [r.kind, r.source])).toEqual([
      ["payment_link", "files"],
      ["price", "files"],
      ["product", "files"],
    ]);
  });
});
