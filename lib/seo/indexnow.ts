// INDEXNOW — telling Bing (and Yandex, Seznam, Naver…) that a page changed,
// instead of waiting for their crawler. Protocol: https://www.indexnow.org/documentation
//
// The key is public by design: the engine checks we own the host by fetching
// it from `keyLocation`, which we serve at `/indexnow.txt` (the root, so it
// validates every URL of the host). It is derived from the Auth.js secret, the
// way the canvas label is (`lib/lienzo/host.ts`): no new env var, a different
// key per install, and nothing in this public repo that a self-hoster would
// end up serving for openlen.com.
//
// Google does not take IndexNow (its Indexing API is only for job postings
// and livestreams): for Google it is still Search Console.

import { createHmac } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_PATH = "/indexnow.txt";

/** 32 hex of `HMAC-SHA256(secret, "openlen-indexnow")`; `null` without a secret.
 *  Both secret names, like the canvas: the box and `.env.local` carry
 *  `NEXTAUTH_SECRET`, and reading only `AUTH_SECRET` already broke one deploy. */
export function indexNowKey(env: Env = process.env): string | null {
  const secret = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update("openlen-indexnow").digest("hex").slice(0, 32);
}

/** What a deploy announces: the root and each locale's home — where the
 *  favicon, the site name and the logo are read. Not the whole sitemap:
 *  IndexNow asks for URLs that CHANGED, and resubmitting unchanged pages on
 *  every deploy is exactly what it asks not to do. */
export function homeUrls(sitemapXml: string, origin: string): string[] {
  const base = new URL(origin).origin;
  const locs = [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
  const homes = locs.filter((loc) => {
    try {
      const u = new URL(loc);
      return u.origin === base && /^\/[a-z]{2}(?:-[A-Za-z]{2})?\/?$/.test(u.pathname);
    } catch {
      return false;
    }
  });
  return [...new Set([`${base}/`, ...homes])];
}

export type IndexNowResult = {
  status: number;
  ok: boolean;
  /** The protocol's own reading of the status code. */
  meaning: string;
  urls: string[];
};

const MEANINGS: Record<number, string> = {
  200: "URLs submitted",
  202: "URLs received; the key is still being validated",
  400: "bad request",
  403: "the key was not valid (key file missing or different)",
  422: "URLs do not belong to the host or the key does not match",
  429: "too many requests",
};

/** Reads the key and the sitemap from the LIVE site and submits its homes.
 *  The key comes from the site itself, so whoever runs this (the deploy, on
 *  Windows) needs no secret: if the key file answers, the engine will be able
 *  to read it too. */
export async function pingIndexNow(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowResult> {
  const base = new URL(origin).origin;
  const keyRes = await fetchImpl(`${base}${INDEXNOW_KEY_PATH}`);
  if (!keyRes.ok) throw new Error(`${INDEXNOW_KEY_PATH} answered ${keyRes.status}: no key to submit with`);
  const key = (await keyRes.text()).trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error(`${INDEXNOW_KEY_PATH} does not hold a valid key`);

  const sitemapRes = await fetchImpl(`${base}/sitemap.xml`);
  if (!sitemapRes.ok) throw new Error(`/sitemap.xml answered ${sitemapRes.status}`);
  const urls = homeUrls(await sitemapRes.text(), base);

  const res = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(base).host,
      key,
      keyLocation: `${base}${INDEXNOW_KEY_PATH}`,
      urlList: urls,
    }),
  });
  return {
    status: res.status,
    ok: res.status === 200 || res.status === 202,
    meaning: MEANINGS[res.status] ?? "unexpected status",
    urls,
  };
}
