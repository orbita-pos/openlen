// lib/shopify/storefront.ts — READING A STORE FROM ITS DOMAIN, WITHOUT A KEY (spec local
// 2026-10-22-shopify-storefront, §5 and §6.1), as measured on 22/10 against Shopify's
// demo store and a real one:
//   · `https://<host>/meta.json` is public on every Shopify store: its myshopify domain,
//     name, currency, country and published counts;
//   · the Storefront API answers without a token at
//     `https://<shop>.myshopify.com/api/<version>/graphql.json` (products, collections,
//     search, the cart).
// The host the user typed goes through `isPublicUrl` (the SSRF gate) on every hop; after
// meta.json, only `*.myshopify.com` is called. Pure apart from StorefrontDeps.

export const STOREFRONT_API_VERSION = "2026-10";
export const SHOPIFY_TIMEOUT_MS = 15_000;
export const SHOPIFY_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

/** A signal that aborts after `ms`, with a `setTimeout` (that tests' fake timers drive)
 *  instead of `AbortSignal.timeout` (which they don't). `clear` once the answer is read. */
export function timeoutSignal(ms: number = SHOPIFY_TIMEOUT_MS): { signal: AbortSignal; clear(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`over ${ms} ms`, "TimeoutError")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export function storefrontApiUrl(shopDomain: string): string {
  return `https://${shopDomain}/api/${STOREFRONT_API_VERSION}/graphql.json`;
}

export function isShopDomain(host: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host);
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The host of what people type (`HTTPS://Www.Tienda.com/x?y`, `tienda.com.`), or null. */
export function normalizeStoreHost(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/, 1)[0] ?? "";
  if (s.includes("@")) return null;
  s = s.replace(/:\d+$/, "").replace(/\.+$/, "");
  const labels = s.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  // A top-level domain is letters (or punycode): this also keeps IPs out.
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1]!)) return null;
  return s;
}

export interface StorefrontDeps {
  fetch: typeof fetch;
  /** The SSRF gate for a host the user typed: true when every address is public. */
  isPublicUrl(url: string): Promise<boolean>;
}

export interface StoreFacts {
  shopDomain: string;
  primaryDomain: string;
  name: string;
  currency: string;
  country: string;
  productsCount: number;
  collectionsCount: number;
}

export interface CatalogSample {
  collections: { handle: string; title: string }[];
  products: { handle: string; title: string; availableForSale: boolean; minPrice: string; maxPrice: string; currency: string }[];
}

export type ReadStoreResult =
  | { kind: "ok"; facts: StoreFacts; sample: CatalogSample }
  | { kind: "invalid_domain" | "not_shopify" | "password" | "unreachable" | "storefront_closed"; message: string };

type Failure = Exclude<ReadStoreResult, { kind: "ok" }>;

const SAMPLE_QUERY =
  "{ shop { name } localization { availableCountries { isoCode } } collections(first: 20) { nodes { handle title } } products(first: 10) { nodes { handle title availableForSale priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } } } } }";

class TooBig extends Error {}

/** The body as text, refusing past SHOPIFY_MAX_BYTES without reading the rest. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > SHOPIFY_MAX_BYTES) {
      // Not awaited: a tee'd stream's cancel waits for its other branch.
      void reader.cancel().catch(() => undefined);
      throw new TooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const failed = (kind: Failure["kind"], message: string): Failure => ({ kind, message });

function networkFailure(e: unknown): Failure {
  if (e instanceof TooBig) return failed("unreachable", "the store's answer is over 1 MB");
  const name = (e as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return failed("unreachable", `it took over ${SHOPIFY_TIMEOUT_MS / 1000} s`);
  return failed("unreachable", e instanceof Error ? e.message : String(e));
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

async function readMeta(host: string, d: StorefrontDeps): Promise<Record<string, unknown> | Failure> {
  let url = `https://${host}/meta.json`;
  for (let hops = 0; ; hops++) {
    const at = new URL(url);
    if (at.protocol !== "https:") return failed("not_shopify", `${host} redirects outside https`);
    if (at.pathname.startsWith("/password")) return failed("password", `${host} is password-protected`);
    if (!(await d.isPublicUrl(url))) return failed(hops === 0 ? "invalid_domain" : "not_shopify", `${at.host} isn't a public address`);
    let res: Response;
    try {
      res = await d.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS), headers: { accept: "application/json" } });
    } catch (e) {
      return networkFailure(e);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hops + 1 > MAX_REDIRECTS) return failed("unreachable", "too many redirects");
      url = new URL(location, url).toString();
      continue;
    }
    if (res.status >= 400) return failed("not_shopify", `${host} answered HTTP ${res.status}`);
    let text: string;
    try {
      text = await readCapped(res);
    } catch (e) {
      return networkFailure(e);
    }
    return parseJson(text) ?? failed("not_shopify", `${host} has no Shopify storefront`);
  }
}

export async function readStore(input: string, d: StorefrontDeps): Promise<ReadStoreResult> {
  const host = normalizeStoreHost(input);
  if (!host) return failed("invalid_domain", "not a domain");
  const meta = await readMeta(host, d);
  if ("kind" in meta) return meta as Failure;
  const shopDomain = str(meta.myshopify_domain)?.toLowerCase() ?? null;
  if (!shopDomain || !isShopDomain(shopDomain)) return failed("not_shopify", `${host} has no Shopify storefront`);

  let gql: Record<string, unknown> | null;
  try {
    const res = await d.fetch(storefrontApiUrl(shopDomain), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: SAMPLE_QUERY }),
      redirect: "manual",
      signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS),
    });
    if (res.status !== 200) return failed("storefront_closed", `HTTP ${res.status}`);
    gql = parseJson(await readCapped(res));
  } catch (e) {
    return networkFailure(e);
  }
  const data = (gql?.data ?? null) as {
    shop?: { name?: unknown } | null;
    localization?: { availableCountries?: { isoCode?: unknown }[] } | null;
    collections?: { nodes?: { handle?: unknown; title?: unknown }[] } | null;
    products?: {
      nodes?: {
        handle?: unknown;
        title?: unknown;
        availableForSale?: unknown;
        priceRange?: { minVariantPrice?: { amount?: unknown; currencyCode?: unknown }; maxVariantPrice?: { amount?: unknown } };
      }[];
    } | null;
  } | null;
  if (!data?.shop) {
    const errors = (gql?.errors ?? []) as { message?: unknown }[];
    return failed("storefront_closed", str(errors[0]?.message) ?? "no answer without a key");
  }

  const markets = (data.localization?.availableCountries ?? []).map((c) => str(c.isoCode)).filter((c): c is string => c !== null);
  const own = str(meta.country);
  const country = own && markets.includes(own) ? own : (markets[0] ?? own ?? "US");
  return {
    kind: "ok",
    facts: {
      shopDomain,
      primaryDomain: str(meta.domain)?.toLowerCase() ?? shopDomain,
      name: str(meta.name) ?? str(data.shop.name) ?? shopDomain,
      currency: str(meta.currency) ?? "",
      country,
      productsCount: count(meta.published_products_count),
      collectionsCount: count(meta.published_collections_count),
    },
    sample: {
      collections: (data.collections?.nodes ?? []).flatMap((c) => {
        const handle = str(c.handle);
        return handle ? [{ handle, title: str(c.title) ?? handle }] : [];
      }),
      products: (data.products?.nodes ?? []).flatMap((p) => {
        const handle = str(p.handle);
        if (!handle) return [];
        const min = p.priceRange?.minVariantPrice;
        return [
          {
            handle,
            title: str(p.title) ?? handle,
            availableForSale: p.availableForSale === true,
            minPrice: str(min?.amount) ?? "",
            maxPrice: str(p.priceRange?.maxVariantPrice?.amount) ?? "",
            currency: str(min?.currencyCode) ?? "",
          },
        ];
      }),
    },
  };
}
