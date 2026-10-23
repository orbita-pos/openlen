// @vitest-environment node
//
// The terminal's `curl` to the connected store's Storefront API (spec local
// 2026-10-22-shopify-storefront, §6.2): only its GraphQL endpoint, only harmless
// headers, no redirects followed, within the time and size limits.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CurlRequest } from "@/lib/functions/curl-types";

import { shopifyCurlFor } from "./curl";
import { memoryShopifyStore } from "./store";

const ROW = {
  projectId: "p1",
  shopDomain: "hydrogen-preview.myshopify.com",
  primaryDomain: "checkout.hydrogen.shop",
  name: "Hydrogen Demo Store",
  currency: "USD",
  country: "CA",
  productsCount: 22,
  collectionsCount: 6,
  checkedAt: new Date("2026-10-22T10:00:00Z"),
  connectedBy: null,
};
const API = "https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json";
const body = (r: { bodyB64: string }) => Buffer.from(r.bodyB64, "base64").toString();
const post = (url: string, headers: Record<string, string> = { "Content-Type": "application/json" }): CurlRequest => ({
  url,
  method: "POST",
  headers,
  bodyB64: Buffer.from('{"query":"{ shop { name } }"}').toString("base64"),
});

async function curlWith(fetchImpl: typeof fetch, enabled = true) {
  const store = memoryShopifyStore();
  await store.put(ROW);
  return shopifyCurlFor("p1", { enabled, store, fetch: fetchImpl });
}

afterEach(() => vi.useRealTimers());

describe("shopifyCurlFor", () => {
  it("is null with Shopify off or no store", async () => {
    expect(await curlWith(vi.fn() as unknown as typeof fetch, false)).toBeNull();
    expect(await shopifyCurlFor("p2", { enabled: true, store: memoryShopifyStore(), fetch: vi.fn() as unknown as typeof fetch })).toBeNull();
  });

  it("reaches the store's Storefront API, and says so", async () => {
    const c = (await curlWith(vi.fn() as unknown as typeof fetch))!;
    expect(c.prefixes).toEqual(["https://hydrogen-preview.myshopify.com/api/"]);
    expect(c.reaches).toBe(`the connected Shopify store's Storefront API (POST ${API})`);
  });

  it("forwards the body and content-type, and drops every other header", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const c = (await curlWith((async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response('{"data":{"shop":{"name":"Hydrogen Demo Store"}}}', { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch))!;
    const r = await c.call(post(API, { "Content-Type": "application/json", Authorization: "Bearer x", Cookie: "a=b", "X-Shopify-Storefront-Access-Token": "t", Accept: "application/json" }));
    expect(r.status).toBe(200);
    expect(body(r)).toBe('{"data":{"shop":{"name":"Hydrogen Demo Store"}}}');
    expect(seen[0]!.url).toBe(API);
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.redirect).toBe("manual");
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(Object.fromEntries(new Headers(seen[0]!.init.headers))).toEqual({ "content-type": "application/json", accept: "application/json" });
    expect(Buffer.from(seen[0]!.init.body as Uint8Array).toString()).toBe('{"query":"{ shop { name } }"}');
  });

  it("anything but the GraphQL endpoint is refused before any request", async () => {
    const f = vi.fn();
    const c = (await curlWith(f as unknown as typeof fetch))!;
    for (const url of ["https://hydrogen-preview.myshopify.com/admin/api/2026-10/graphql.json", "https://hydrogen-preview.myshopify.com/api/2026-10/products.json", "https://hydrogen-preview.myshopify.com/api/latest/graphql.json"]) {
      await expect(c.call(post(url))).rejects.toThrow("Only the Storefront API's GraphQL endpoint is reachable");
    }
    await expect(c.call({ ...post(API), method: "DELETE" })).rejects.toThrow("Only the Storefront API's GraphQL endpoint is reachable");
    expect(f).not.toHaveBeenCalled();
  });

  it("a redirect comes back as it is, not followed", async () => {
    const c = (await curlWith((async () => new Response(null, { status: 301, headers: { location: "https://elsewhere.example/" } })) as unknown as typeof fetch))!;
    const r = await c.call(post(API));
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe("https://elsewhere.example/");
  });

  it("an answer over 1 MB is an error, not a hang", async () => {
    const c = (await curlWith((async () => new Response("x".repeat(2_000_000), { status: 200 })) as unknown as typeof fetch))!;
    await expect(c.call(post(API))).rejects.toThrow("The store's answer is over 1 MB: ask for fewer fields or fewer items (first: …)");
  });

  it("a store that never answers is cut by the timeout", async () => {
    vi.useFakeTimers();
    const c = (await curlWith(((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      })) as unknown as typeof fetch))!;
    const pending = c.call(post(API));
    const check = expect(pending).rejects.toThrow(/15 s/);
    await vi.advanceTimersByTimeAsync(15_001);
    await check;
  });
});
