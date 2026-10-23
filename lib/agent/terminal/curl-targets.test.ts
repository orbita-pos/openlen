import { describe, expect, it, vi } from "vitest";

import type { CurlRequest, FunctionsCurl } from "@/lib/functions/curl-types";

import { mergeCurls } from "./curl-targets";

const answer = (body: string) => ({ status: 200, statusText: "OK", headers: {}, bodyB64: Buffer.from(body).toString("base64") });
const req = (url: string): CurlRequest => ({ url, method: "POST", headers: {}, bodyB64: null });

describe("mergeCurls", () => {
  it("nothing to merge is no curl", () => {
    expect(mergeCurls([null, null])).toBeNull();
    expect(mergeCurls([])).toBeNull();
  });

  it("one curl is itself", () => {
    const one: FunctionsCurl = { prefixes: ["https://a/"], call: vi.fn(async () => answer("a")) };
    expect(mergeCurls([null, one])).toBe(one);
  });

  it("the functions and the store: both prefixes, each call to its own, and both reaches", async () => {
    const functions: FunctionsCurl = {
      prefixes: ["https://p.openlen.app/functions/v1/"],
      reaches: "this project's Edge Functions (https://p.openlen.app/functions/v1/<name>)",
      call: vi.fn(async () => answer("fn")),
    };
    const shop: FunctionsCurl = {
      prefixes: ["https://x.myshopify.com/api/"],
      reaches: "the connected Shopify store's Storefront API (POST https://x.myshopify.com/api/2026-10/graphql.json)",
      call: vi.fn(async () => answer("shop")),
    };
    const m = mergeCurls([functions, shop])!;
    expect(m.prefixes).toEqual(["https://p.openlen.app/functions/v1/", "https://x.myshopify.com/api/"]);
    expect(m.reaches).toBe(
      "this project's Edge Functions (https://p.openlen.app/functions/v1/<name>) and the connected Shopify store's Storefront API (POST https://x.myshopify.com/api/2026-10/graphql.json)",
    );
    expect(Buffer.from((await m.call(req("https://x.myshopify.com/api/2026-10/graphql.json"))).bodyB64, "base64").toString()).toBe("shop");
    expect(Buffer.from((await m.call(req("https://p.openlen.app/functions/v1/hello"))).bodyB64, "base64").toString()).toBe("fn");
    await expect(m.call(req("https://example.com/"))).rejects.toThrow(/Network access denied/);
  });
});
