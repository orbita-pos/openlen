// lib/shopify/curl.ts — THE TERMINAL'S `curl` TO THE CONNECTED STORE (spec local
// 2026-10-22-shopify-storefront, §6.2): Len reads the catalog the way Claude Code would,
// POSTing GraphQL to the Storefront API without a key. Only that endpoint of the store's
// myshopify host, only content-type and accept, no cookies, no redirects followed, within
// SHOPIFY_TIMEOUT_MS and SHOPIFY_MAX_BYTES; the answer comes back as it is.

import type { CurlResponse, FunctionsCurl } from "@/lib/functions/curl-types";

import { SHOPIFY_MAX_BYTES, SHOPIFY_TIMEOUT_MS, STOREFRONT_API_VERSION, timeoutSignal } from "./storefront";
import type { ShopifyStore } from "./types";

const ONLY_GRAPHQL = "Only the Storefront API's GraphQL endpoint is reachable";
const TOO_BIG = "The store's answer is over 1 MB: ask for fewer fields or fewer items (first: …)";
const FORWARDED = new Set(["content-type", "accept"]);

async function bodyCapped(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > SHOPIFY_MAX_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new Error(TOO_BIG);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

interface CurlDeps {
  enabled: boolean;
  store: ShopifyStore;
  fetch: typeof fetch;
}

async function realCurlDeps(): Promise<CurlDeps> {
  const [{ shopifyEnabledIn }, { realShopifyStore }] = await Promise.all([import("./enabled"), import("./real")]);
  return { enabled: shopifyEnabledIn(), store: realShopifyStore(), fetch: (input, init) => fetch(input, init) };
}

export async function shopifyCurlFor(projectId: string, deps?: CurlDeps): Promise<FunctionsCurl | null> {
  const d = deps ?? (await realCurlDeps());
  if (!d.enabled) return null;
  const row = await d.store.get(projectId);
  if (!row) return null;
  const prefix = `https://${row.shopDomain}/api/`;
  const endpoint = new RegExp(`^https://${row.shopDomain.replace(/\./g, "\\.")}/api/\\d{4}-\\d{2}/graphql\\.json(\\?.*)?$`);
  return {
    prefixes: [prefix],
    reaches: `the connected Shopify store's Storefront API (POST https://${row.shopDomain}/api/${STOREFRONT_API_VERSION}/graphql.json)`,
    async call(req): Promise<CurlResponse> {
      if (!endpoint.test(req.url) || (req.method !== "POST" && req.method !== "GET")) throw new Error(ONLY_GRAPHQL);
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => FORWARDED.has(k.toLowerCase())).map(([k, v]) => [k.toLowerCase(), v]));
      const t = timeoutSignal();
      try {
        const res = await d.fetch(req.url, {
          method: req.method,
          headers,
          ...(req.method === "POST" && req.bodyB64 !== null ? { body: Buffer.from(req.bodyB64, "base64") } : {}),
          redirect: "manual",
          credentials: "omit",
          signal: t.signal,
        });
        const bytes = await bodyCapped(res);
        return { status: res.status, statusText: res.statusText, headers: Object.fromEntries([...res.headers]), bodyB64: bytes.toString("base64") };
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === "AbortError" || name === "TimeoutError") throw new Error(`The store didn't answer in ${SHOPIFY_TIMEOUT_MS / 1000} s`);
        throw e;
      } finally {
        t.clear();
      }
    },
  };
}
