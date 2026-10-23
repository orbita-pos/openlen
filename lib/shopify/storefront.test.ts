// @vitest-environment node
//
// Reading a Shopify store from its domain, without a key (spec local
// 2026-10-22-shopify-storefront, §6.1). The fixtures are trimmed copies of what
// Shopify's demo store answered on 22/10; a fake `fetch` answers by URL.
import { describe, expect, it } from "vitest";

import { isShopDomain, normalizeStoreHost, readStore, storefrontApiUrl, type StorefrontDeps } from "./storefront";

const META = {
  id: 55145660472,
  name: "Hydrogen Demo Store",
  country: "CA",
  currency: "USD",
  domain: "checkout.hydrogen.shop",
  myshopify_domain: "hydrogen-preview.myshopify.com",
  published_products_count: 22,
  published_collections_count: 6,
};
const GRAPHQL = {
  data: {
    shop: { name: "Hydrogen Demo Store" },
    localization: { availableCountries: [{ isoCode: "AD" }, { isoCode: "CA" }, { isoCode: "US" }] },
    collections: { nodes: [{ handle: "freestyle", title: "Freestyle Collection" }] },
    products: {
      nodes: [
        {
          handle: "v2-snowboard",
          title: "The Hydrogen Snowboard",
          availableForSale: true,
          priceRange: { minVariantPrice: { amount: "500.0", currencyCode: "USD" }, maxVariantPrice: { amount: "600.0", currencyCode: "USD" } },
        },
      ],
    },
  },
};
const API = "https://hydrogen-preview.myshopify.com/api/2026-10/graphql.json";

type Answer = Response | (() => Response | Promise<Response>);
function world(answers: Record<string, Answer>, isPublic: (url: string) => boolean = () => true) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const checked: string[] = [];
  const d: StorefrontDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const a = answers[url];
      if (!a) return new Response("not found", { status: 404 });
      return typeof a === "function" ? a() : a.clone();
    }) as typeof fetch,
    isPublicUrl: async (url) => {
      checked.push(url);
      return isPublic(url);
    },
  };
  return { d, calls, checked };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const redirect = (location: string, status = 301) => new Response(null, { status, headers: { location } });

describe("normalizeStoreHost", () => {
  it("keeps the host of what people type", () => {
    expect(normalizeStoreHost("HTTPS://Www.Tienda.com/products/x?y=1")).toBe("www.tienda.com");
    expect(normalizeStoreHost("tienda.com.")).toBe("tienda.com");
    expect(normalizeStoreHost("  tienda.myshopify.com  ")).toBe("tienda.myshopify.com");
    expect(normalizeStoreHost("tienda.com:443/")).toBe("tienda.com");
  });

  it("refuses what isn't a public domain", () => {
    for (const bad of ["localhost", "127.0.0.1", "tienda", "", "a b.com", "user@tienda.com", "-x.com", "tienda.c0m"]) {
      expect(normalizeStoreHost(bad), bad).toBeNull();
    }
  });
});

describe("isShopDomain and storefrontApiUrl", () => {
  it("only *.myshopify.com, and the endpoint with the pinned version", () => {
    expect(isShopDomain("hydrogen-preview.myshopify.com")).toBe(true);
    expect(isShopDomain("evil.example.com")).toBe(false);
    expect(isShopDomain("a.b.myshopify.com")).toBe(false);
    expect(isShopDomain("myshopify.com")).toBe(false);
    expect(storefrontApiUrl("hydrogen-preview.myshopify.com")).toBe(API);
  });
});

describe("readStore", () => {
  it("reads the store's facts and a sample of its catalog", async () => {
    const { d, calls } = world({ "https://checkout.hydrogen.shop/meta.json": json(META), [API]: json(GRAPHQL) });
    const r = await readStore("checkout.hydrogen.shop", d);
    expect(r).toEqual({
      kind: "ok",
      facts: {
        shopDomain: "hydrogen-preview.myshopify.com",
        primaryDomain: "checkout.hydrogen.shop",
        name: "Hydrogen Demo Store",
        currency: "USD",
        country: "CA",
        productsCount: 22,
        collectionsCount: 6,
      },
      sample: {
        collections: [{ handle: "freestyle", title: "Freestyle Collection" }],
        products: [{ handle: "v2-snowboard", title: "The Hydrogen Snowboard", availableForSale: true, minPrice: "500.0", maxPrice: "600.0", currency: "USD" }],
      },
    });
    const sf = calls.find((c) => c.url === API)!;
    expect(sf.init?.method).toBe("POST");
    const headers = new Headers(sf.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-shopify-storefront-access-token")).toBeNull();
    expect(JSON.parse(String(sf.init?.body)).query).toContain("availableCountries");
  });

  it("the country falls back to the first market when the shop's own isn't one", async () => {
    const { d } = world({ "https://checkout.hydrogen.shop/meta.json": json({ ...META, country: "MX" }), [API]: json(GRAPHQL) });
    const r = await readStore("checkout.hydrogen.shop", d);
    expect(r.kind === "ok" && r.facts.country).toBe("AD");
  });

  it("follows an apex → www redirect, checking every hop", async () => {
    const { d, checked } = world({
      "https://tienda.com/meta.json": redirect("https://www.tienda.com/meta.json"),
      "https://www.tienda.com/meta.json": json(META),
      [API]: json(GRAPHQL),
    });
    expect((await readStore("tienda.com", d)).kind).toBe("ok");
    expect(checked).toEqual(["https://tienda.com/meta.json", "https://www.tienda.com/meta.json"]);
  });

  it("a host that isn't public is refused before any request", async () => {
    const { d, calls } = world({}, () => false);
    expect((await readStore("tienda.com", d)).kind).toBe("invalid_domain");
    expect(calls).toHaveLength(0);
  });

  it("refuses what isn't a domain without any request", async () => {
    const { d, calls } = world({});
    expect((await readStore("localhost", d)).kind).toBe("invalid_domain");
    expect(calls).toHaveLength(0);
  });

  it("a password page, an HTML page or a 403 is not an open store", async () => {
    expect((await readStore("tienda.com", world({ "https://tienda.com/meta.json": redirect("/password", 302) }).d)).kind).toBe("password");
    expect((await readStore("tienda.com", world({ "https://tienda.com/meta.json": new Response("<html>hola</html>", { status: 200 }) }).d)).kind).toBe("not_shopify");
    expect((await readStore("tienda.com", world({ "https://tienda.com/meta.json": new Response("no", { status: 403 }) }).d)).kind).toBe("not_shopify");
  });

  it("too many redirects, a dead fetch or a huge meta.json can't be reached", async () => {
    const loop = world({
      "https://tienda.com/meta.json": redirect("https://a.tienda.com/meta.json"),
      "https://a.tienda.com/meta.json": redirect("https://b.tienda.com/meta.json"),
      "https://b.tienda.com/meta.json": redirect("https://c.tienda.com/meta.json"),
      "https://c.tienda.com/meta.json": redirect("https://d.tienda.com/meta.json"),
    });
    expect((await readStore("tienda.com", loop.d)).kind).toBe("unreachable");
    const dead = world({
      "https://tienda.com/meta.json": () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    expect((await readStore("tienda.com", dead.d)).kind).toBe("unreachable");
    const huge = world({ "https://tienda.com/meta.json": new Response("x".repeat(2_000_000), { status: 200 }) });
    const r = await readStore("tienda.com", huge.d);
    expect(r.kind).toBe("unreachable");
    expect(r.kind !== "ok" && r.message).toMatch(/1 MB/);
  });

  it("a Storefront API that refuses without a key is closed", async () => {
    const { d } = world({ "https://checkout.hydrogen.shop/meta.json": json(META), [API]: json({ errors: [{ message: "Unauthorized" }] }, 401) });
    expect((await readStore("checkout.hydrogen.shop", d)).kind).toBe("storefront_closed");
  });

  it("a meta.json that names a host outside myshopify.com is not a store, and Shopify is never called", async () => {
    const { d, calls } = world({ "https://tienda.com/meta.json": json({ ...META, myshopify_domain: "evil.example.com" }) });
    expect((await readStore("tienda.com", d)).kind).toBe("not_shopify");
    expect(calls.map((c) => c.url)).toEqual(["https://tienda.com/meta.json"]);
  });

  it("every request carries a timeout signal and doesn't follow redirects by itself", async () => {
    const { d, calls } = world({ "https://checkout.hydrogen.shop/meta.json": json(META), [API]: json(GRAPHQL) });
    await readStore("checkout.hydrogen.shop", d);
    for (const c of calls) {
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
      expect(c.init?.redirect).toBe("manual");
    }
  });
});
