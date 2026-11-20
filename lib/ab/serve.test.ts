// @vitest-environment node
// TypeScript Edge A/B resolver tests (Plan 3):
//   - Bit-for-bit parity with Rust `crates/edge/src/ab/assign.rs`
//   - Bot isolation (Control A, no cookies)
//   - Sticky cookie + QA query override (`?_ol_ab=a|b` + `X-Robots-Tag: noindex`)
//   - Internal path blocking (`/openlen/ab.json`, `/openlen/ab/*`)
//   - Strict Variant B file resolution without fallback to Control A
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AB_HTML_CACHE_CONTROL,
  abResponseHeaders,
  evaluateAbManifest,
  hashBucket,
  hashVariant,
  isBlockedInternalAbPath,
  isEdgeBot,
  parseAbManifest,
  readReleaseAbManifest,
  resolveVariantBFile,
} from "./serve";

const MANIFEST = parseAbManifest(
  JSON.stringify({
    version: 1,
    releaseSha: "abc123456789",
    experiments: [
      {
        id: "ab_9f3c2a1b",
        cookieName: "ol_ab_9f3c2a1b",
        targetPath: "/",
        includeLocales: true,
        locales: ["es", "fr"],
        splitBps: 5000,
        salt: "3f9a1c8e7b2d4012",
        prefixB: "openlen/ab/ab_9f3c2a1b/b",
        overrideParam: "_ol_ab",
        expiresAt: null,
      },
    ],
  }),
)!;

describe("lib/ab/serve", () => {
  it("matches the Rust golden hash vectors bit-for-bit (one shared JSON file)", () => {
    const doc = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "crates", "edge", "tests", "fixtures", "ab", "hash-vectors.json"),
        "utf8",
      ),
    ) as {
      vectors: { salt: string; expId: string; ip: string; ua: string; lang: string; bucket: number }[];
    };
    expect(doc.vectors.length).toBeGreaterThanOrEqual(10);
    for (const v of doc.vectors) {
      expect(hashBucket(v.salt, v.expId, v.ip, v.ua, v.lang), JSON.stringify(v)).toBe(v.bucket);
      // A visitor is in B iff bucket < splitBps: the boundary is exact.
      expect(hashVariant(v.salt, v.expId, v.ip, v.ua, v.lang, v.bucket)).toBe("a");
      if (v.bucket < 9_999) {
        expect(hashVariant(v.salt, v.expId, v.ip, v.ua, v.lang, v.bucket + 1)).toBe("b");
      }
    }
  });

  it("buckets are uniform, so every split gets its share (200k visitors, +/- 0.5 %)", () => {
    // The bucket is the first 4 bytes as a u32 modulo 10_000 (bias 2e-6). A u16 modulo 10_000
    // (the first version) sent 53.4 % of a 50/50 to B and tripped the sample-ratio guard at ~2,300
    // visits; this pins the exact expectation instead of a band that passes by luck.
    const N = 200_000;
    const buckets = new Uint16Array(N);
    for (let i = 0; i < N; i++) {
      const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
      buckets[i] = hashBucket("3f9a1c8e7b2d4012", "ab_9f3c2a1b", ip, "UA", "en");
    }
    for (const split of [1000, 2500, 5000, 7500, 9000]) {
      let inB = 0;
      for (const b of buckets) if (b < split) inB++;
      expect(Math.abs(inB / N - split / 10_000), `split ${split}`).toBeLessThanOrEqual(0.005);
    }
  });

  it("blocks /ab.json and /_ab/* internal paths regardless of casing", () => {
    expect(isBlockedInternalAbPath("/openlen/ab.json")).toBe(true);
    expect(isBlockedInternalAbPath("/OPENLEN/AB.JSON")).toBe(true);
    expect(isBlockedInternalAbPath("/openlen/ab")).toBe(true);
    expect(isBlockedInternalAbPath("/openlen/ab/ab_9f3c2a1b/b/index.html")).toBe(true);
    expect(isBlockedInternalAbPath("/")).toBe(false);
    expect(isBlockedInternalAbPath("/pricing")).toBe(false);
    // Other files of the reserved `openlen/` root keep being served.
    expect(isBlockedInternalAbPath("/openlen/figure-0a1b2c3d.js")).toBe(false);
    // The pre-move layout is an ordinary path now.
    expect(isBlockedInternalAbPath("/ab.json")).toBe(false);
    expect(isBlockedInternalAbPath("/_ab/x")).toBe(false);
  });

  it("always sends Control A without Set-Cookie to crawlers, social bots, and headless tools", () => {
    for (const ua of [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "GPTBot/1.0",
      "ClaudeBot/1.0",
      "curl/8.4.0",
      "Mozilla/5.0 HeadlessChrome/131.0",
      "",
    ]) {
      expect(isEdgeBot(ua), ua).toBe(true);
      const dec = evaluateAbManifest(MANIFEST, {
        urlPath: "/",
        userAgent: ua,
        clientIp: "203.0.113.10",
      });
      expect(dec?.variant).toBe("a");
      expect(dec?.source).toBe("bot");
      expect(dec?.setCookie).toBeNull();
    }
  });

  it("honors ?_ol_ab override (adding noindex) and sticky cookies without re-minting", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36";

    const ov = evaluateAbManifest(MANIFEST, {
      urlPath: "/",
      searchParams: new URLSearchParams("_ol_ab=b"),
      cookieHeader: "ol_ab_9f3c2a1b=a",
      userAgent: "Googlebot/2.1",
      clientIp: "1.2.3.4",
    });
    expect(ov?.variant).toBe("b");
    expect(ov?.source).toBe("override");
    expect(ov?.isOverride).toBe(true);
    expect(ov?.setCookie).toBeNull();
    const ovHeaders = abResponseHeaders(ov!, 1234);
    expect(ovHeaders["Cache-Control"]).toBe(AB_HTML_CACHE_CONTROL);
    expect(ovHeaders["Vary"]).toBe("Cookie");
    expect(ovHeaders["X-Robots-Tag"]).toBe("noindex");
    expect(ovHeaders["X-OpenLen-AB"]).toBe("ab_9f3c2a1b:b");

    const sticky = evaluateAbManifest(MANIFEST, {
      urlPath: "/es/",
      cookieHeader: "foo=1; ol_ab_9f3c2a1b=b",
      userAgent: chrome,
      clientIp: "198.51.100.42",
    });
    expect(sticky?.variant).toBe("b");
    expect(sticky?.source).toBe("cookie");
    expect(sticky?.setCookie).toBeNull();
    expect(sticky?.variantBPath).toBe("/openlen/ab/ab_9f3c2a1b/b/es");

    const firstVisit = evaluateAbManifest(MANIFEST, {
      urlPath: "/",
      userAgent: chrome,
      acceptLanguage: "es-MX,es;q=0.9",
      clientIp: "203.0.113.10",
      secureCookie: true,
    });
    expect(firstVisit?.source).toBe("hash");
    expect(firstVisit?.setCookie).toContain("ol_ab_9f3c2a1b=");
    expect(firstVisit?.setCookie).toContain("SameSite=Lax; Secure");

    expect(
      evaluateAbManifest(MANIFEST, {
        urlPath: "/about",
        userAgent: chrome,
        clientIp: "203.0.113.10",
      }),
    ).toBeNull();
  });

  it("fails open (returns null) on invalid manifest or traversal prefixB", () => {
    expect(parseAbManifest("{broken")).toBeNull();
    expect(parseAbManifest(JSON.stringify({ version: 2, experiments: [] }))).toBeNull();
    expect(
      parseAbManifest(
        JSON.stringify({
          version: 1,
          releaseSha: "sha",
          experiments: [
            {
              id: "ab_12345678",
              cookieName: "ol_ab_12345678",
              targetPath: "/",
              splitBps: 5000,
              salt: "abc",
              prefixB: "openlen/ab/../etc/passwd",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("resolves Variant B files strictly inside releaseDir without falling back to Control A", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openlen-ab-serve-"));
    try {
      const bTree = path.join(dir, "openlen", "ab", "ab_9f3c2a1b", "b");
      await mkdir(path.join(bTree, "es"), { recursive: true });
      await writeFile(path.join(dir, "index.html"), "<h1>Control</h1>");
      await writeFile(path.join(bTree, "index.html"), "<h1>B</h1>");
      await writeFile(path.join(bTree, "es", "index.html"), "<h1>B ES</h1>");

      const foundHome = await resolveVariantBFile(dir, "/openlen/ab/ab_9f3c2a1b/b/index.html", true);
      expect(foundHome).toBe(path.join(bTree, "index.html"));

      const foundEs = await resolveVariantBFile(dir, "/openlen/ab/ab_9f3c2a1b/b/es", true);
      expect(foundEs).toBe(path.join(bTree, "es", "index.html"));

      const missing = await resolveVariantBFile(dir, "/openlen/ab/ab_9f3c2a1b/b/fr", true);
      expect(missing).toBeNull();

      const escapeAttempt = await resolveVariantBFile(dir, "/openlen/ab/../../index.html", true);
      expect(escapeAttempt).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lib/ab/serve — the manifest lives under the reserved openlen/ root", () => {
  const base = {
    id: "ab_12345678",
    cookieName: "ol_ab_12345678",
    targetPath: "/",
    splitBps: 5000,
    salt: "abcd",
  };
  const withPrefix = (prefixB: string) =>
    parseAbManifest(JSON.stringify({ version: 1, experiments: [{ ...base, prefixB }] }));

  it("accepts only openlen/ab/<id>/… as Variant B's prefix", () => {
    expect(withPrefix("openlen/ab/ab_12345678/b")).not.toBeNull();
    expect(withPrefix("_ab/ab_12345678/b")).toBeNull();
    expect(withPrefix("openlen/figure/b")).toBeNull();
    expect(withPrefix("openlen/ab")).toBeNull();
    expect(withPrefix("img/ab/b")).toBeNull();
  });

  it("reads <release>/openlen/ab.json, and no longer <release>/ab.json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openlen-ab-layout-"));
    try {
      const doc = JSON.stringify({
        version: 1,
        experiments: [{ ...base, prefixB: "openlen/ab/ab_12345678/b" }],
      });
      await writeFile(path.join(dir, "ab.json"), doc);
      expect(await readReleaseAbManifest(dir)).toBeNull();
      await mkdir(path.join(dir, "openlen"), { recursive: true });
      await writeFile(path.join(dir, "openlen", "ab.json"), doc);
      expect((await readReleaseAbManifest(dir))?.experiments).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
