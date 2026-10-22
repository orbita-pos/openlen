import { describe, expect, it, vi } from "vitest";

import { memorySecretStore } from "@/lib/functions/secret-store";
import { FunctionSecretsMissingError, FunctionsNeedOwnerError } from "@/lib/functions/publish-errors";

import { stripeCall } from "./api";
import { prepareStripeForPublish, storedTwins, type StripePublishDeps } from "./publish";
import { StripeAccountMismatchError, StripeNeedsOwnerError, StripeSyncFailedError, stripePublishErrorBody } from "./publish-errors";
import { memoryStripeStore } from "./store";
import { fakeStripe } from "./twins/fake-stripe";

const DRAFT_FN = "https://draftrefdraftrefdraf.openlen.app/functions/v1/";
const LIVE_FN = "https://liverefliverefliveref.openlen.app/functions/v1/";

async function world(o: { liveKey?: string | null } = {}) {
  const stripe = fakeStripe();
  const store = memoryStripeStore();
  const secrets = memorySecretStore();
  await secrets.set("p", "draft", { STRIPE_SECRET_KEY: "sk_test_x" }, null);
  if (o.liveKey !== null) await secrets.set("p", "live", { STRIPE_SECRET_KEY: o.liveKey ?? "sk_live_x" }, null);
  const saved: [string, string][] = [];
  const deps: StripePublishDeps = {
    enabled: true,
    store,
    secrets,
    functionUrls: async () => ({ draft: DRAFT_FN, live: LIVE_FN }),
    canvasHost: null,
    saveLiveSecret: async (_p, name, value) => void saved.push([name, value]),
    checkKey: vi.fn(async (_v: string, env: "draft" | "live") => ({ ok: true as const, account: { accountId: "acct_fake", accountName: "Taller", keyKind: "sk" as const, livemode: env === "live", chargesEnabled: env === "live" ? false : null } })),
    f: stripe.fetch,
  };
  const t = <T>(path: string, params: Record<string, unknown>) => stripeCall<T>("sk_test_x", "POST", path, params, { f: stripe.fetch });
  async function link() {
    const product = await t<{ id: string }>("/v1/products", { name: "Taza" });
    const price = await t<{ id: string }>("/v1/prices", { product: product.id, unit_amount: 1500, currency: "mxn" });
    return t<{ id: string; url: string }>("/v1/payment_links", { line_items: [{ price: price.id, quantity: 1 }] });
  }
  return { stripe, store, secrets, deps, saved, link };
}

const OWNER = { mode: "owner" as const, skipMissingSecrets: false, liveFunctions: [] };

describe("prepareStripeForPublish", () => {
  it("nothing of Stripe in the project → null, and no call to Stripe", async () => {
    const w = await world();
    expect(await prepareStripeForPublish("p", { ...OWNER, texts: ["<h1>Hola</h1>"] }, w.deps)).toBeNull();
    expect(w.stripe.calls).toEqual([]);
  });

  it("Stripe off → null", async () => {
    const w = await world();
    const l = await w.link();
    expect(await prepareStripeForPublish("p", { ...OWNER, texts: [l.url] }, { ...w.deps, enabled: false })).toBeNull();
  });

  it("a page with a test payment link: the preview counts, apply creates and maps the link", async () => {
    const w = await world();
    const l = await w.link();
    const s = (await prepareStripeForPublish("p", { ...OWNER, texts: [`<a href="${l.url}">`] }, w.deps))!;
    expect(s.preview.plan.create).toMatchObject({ products: 1, prices: 1, paymentLinks: 1 });
    expect(s.preview.plan.chargesEnabled).toBe(false);
    expect(s.preview.accountName).toBe("Taller");
    expect(w.stripe.liveWrites()).toBe(0);
    const map = await s.apply();
    expect(map.get(l.url)).toMatch(/^https:\/\/buy\.stripe\.com\/(?!test_)/);
  });

  it("missing live key → the 428 of missing secrets, with STRIPE_SECRET_KEY", async () => {
    const w = await world({ liveKey: null });
    const l = await w.link();
    await expect(prepareStripeForPublish("p", { ...OWNER, texts: [l.url] }, w.deps)).rejects.toEqual(new FunctionSecretsMissingError(["STRIPE_SECRET_KEY"]));
  });

  it("Review 5: «publish anyway» without the live key → null: no call to Stripe, the test refs stay", async () => {
    const w = await world({ liveKey: null });
    const l = await w.link();
    const before = w.stripe.calls.length;
    expect(await prepareStripeForPublish("p", { ...OWNER, skipMissingSecrets: true, texts: [l.url] }, w.deps)).toBeNull();
    expect(w.stripe.calls.length).toBe(before);
  });

  it("another account in live → StripeAccountMismatchError (422)", async () => {
    const w = await world();
    const l = await w.link();
    await w.store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_1", accountName: null, keyKind: "sk", chargesEnabled: null });
    await w.store.putAccount({ projectId: "p", environment: "live", accountId: "acct_2", accountName: null, keyKind: "sk", chargesEnabled: true });
    const e = await prepareStripeForPublish("p", { ...OWNER, texts: [l.url] }, w.deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StripeAccountMismatchError);
    expect(stripePublishErrorBody(e)).toEqual({ status: 422, body: { error: "stripe_account_mismatch" } });
  });

  it("an account row that is missing is checked and written", async () => {
    const w = await world();
    const l = await w.link();
    await prepareStripeForPublish("p", { ...OWNER, texts: [l.url] }, w.deps);
    expect(w.deps.checkKey).toHaveBeenCalledTimes(2);
    expect(await w.store.getAccount("p", "live")).toMatchObject({ accountId: "acct_fake", chargesEnabled: false });
  });

  it("a Stripe failure during apply → StripeSyncFailedError (502)", async () => {
    const w = await world();
    const l = await w.link();
    const s = (await prepareStripeForPublish("p", { ...OWNER, texts: [l.url] }, w.deps))!;
    w.stripe.failWrite(1, 99);
    const e = await s.apply().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StripeSyncFailedError);
    expect(stripePublishErrorBody(e)).toMatchObject({ status: 502, body: { error: "stripe_sync_failed" } });
  });

  it("Review 2: a system republish with the twins already made writes nothing to Stripe and maps the same", async () => {
    const w = await world();
    const l = await w.link();
    const owner = (await prepareStripeForPublish("p", { ...OWNER, texts: [l.url] }, w.deps))!;
    const first = await owner.apply();
    const writes = w.stripe.liveWrites();
    const sys = (await prepareStripeForPublish("p", { ...OWNER, mode: "system", texts: [l.url] }, w.deps))!;
    expect([...(await sys.apply())]).toEqual([...first]);
    expect(w.stripe.liveWrites()).toBe(writes);
    expect([...(await storedTwins("p", w.deps))]).toEqual([...first]);
  });

  it("a system republish that would need a new twin → StripeNeedsOwnerError, which republishers skip like the functions'", async () => {
    const w = await world();
    const l = await w.link();
    const e = await prepareStripeForPublish("p", { ...OWNER, mode: "system", texts: [l.url] }, w.deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StripeNeedsOwnerError);
    expect(e).toBeInstanceOf(FunctionsNeedOwnerError);
  });
});
