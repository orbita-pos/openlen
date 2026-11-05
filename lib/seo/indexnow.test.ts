import { describe, expect, it } from "vitest";
import { GET } from "@/app/indexnow.txt/route";
import { homeUrls, indexNowKey, INDEXNOW_ENDPOINT, pingIndexNow } from "./indexnow";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
<url><loc>https://openlen.com/en</loc></url>
<url><loc>https://openlen.com/es</loc></url>
<url><loc>https://openlen.com/es/templates</loc></url>
<url><loc>https://openlen.com/en/blog/hello</loc></url>
<url><loc>https://other.example/en</loc></url>
</urlset>`;

describe("indexNowKey", () => {
  it("is 32 hex, stable for one secret and different for another", () => {
    const a = indexNowKey({ AUTH_SECRET: "s1" });
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(indexNowKey({ AUTH_SECRET: "s1" })).toBe(a);
    expect(indexNowKey({ AUTH_SECRET: "s2" })).not.toBe(a);
  });

  it("reads NEXTAUTH_SECRET too, the name the box carries", () => {
    expect(indexNowKey({ NEXTAUTH_SECRET: "s1" })).toBe(indexNowKey({ AUTH_SECRET: "s1" }));
  });

  it("is null without a secret", () => {
    expect(indexNowKey({})).toBeNull();
    expect(indexNowKey({ AUTH_SECRET: "  " })).toBeNull();
  });
});

describe("homeUrls", () => {
  it("keeps the root and the locale homes of the host, nothing else", () => {
    expect(homeUrls(SITEMAP, "https://openlen.com")).toEqual([
      "https://openlen.com/",
      "https://openlen.com/en",
      "https://openlen.com/es",
    ]);
  });
});

describe("GET /indexnow.txt", () => {
  it("serves the key as plain text", async () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "s1";
    try {
      const res = GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe(indexNowKey({ AUTH_SECRET: "s1" }));
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });
});

describe("pingIndexNow", () => {
  const KEY = "0123456789abcdef0123456789abcdef";

  function fakeFetch(status: number, key = KEY) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/indexnow.txt")) return new Response(key);
      if (url.endsWith("/sitemap.xml")) return new Response(SITEMAP);
      if (url === INDEXNOW_ENDPOINT) return new Response(null, { status });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    return { impl, calls };
  }

  it("submits the homes with the key read from the live site", async () => {
    const { impl, calls } = fakeFetch(202);
    const r = await pingIndexNow("https://openlen.com/en", impl);
    expect(r).toMatchObject({ status: 202, ok: true });
    const post = calls.find((c) => c.url === INDEXNOW_ENDPOINT)!;
    expect(post.init?.method).toBe("POST");
    expect(JSON.parse(String(post.init?.body))).toEqual({
      host: "openlen.com",
      key: KEY,
      keyLocation: "https://openlen.com/indexnow.txt",
      urlList: ["https://openlen.com/", "https://openlen.com/en", "https://openlen.com/es"],
    });
  });

  it("reports a rejected key as not ok, with the protocol's reason", async () => {
    const { impl } = fakeFetch(403);
    expect(await pingIndexNow("https://openlen.com", impl)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses to submit when the key file holds no valid key", async () => {
    const { impl, calls } = fakeFetch(200, "<html>404</html>");
    await expect(pingIndexNow("https://openlen.com", impl)).rejects.toThrow(/valid key/);
    expect(calls.some((c) => c.url === INDEXNOW_ENDPOINT)).toBe(false);
  });
});
