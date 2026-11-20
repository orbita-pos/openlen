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
  isInternalAbFile,
  parseAbManifest,
  readReleaseAbManifest,
  ReleaseAbManifestCache,
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

describe("lib/ab/serve — internal files are blocked on the RESOLVED path", () => {
  it("blocks every spelling that reaches the manifest or B's tree once resolved", () => {
    for (const p of [
      "/openlen/ab.json/",
      "/openlen/%61b.json",
      "/openlen/%61B.JSON",
      "/openlen/./ab.json",
      "/openlen//ab.json",
      "//openlen/ab.json",
      "/foo/../openlen/ab.json",
      "/openlen/ab%2Ejson",
      "/openlen%2Fab.json",
      "/openlen/ab/",
      "/openlen/%61b",
      "/openlen/%61b/ab_9f3c2a1b/b/index.html",
      "/openlen/./ab/ab_9f3c2a1b/b/index.html",
      "/OpEnLeN/Ab/ab_9f3c2a1b/b/index.html",
      "/openlen/ab/../ab/x",
      "/openlen\\ab.json",
      "/openlen/ab.json%00.png",
    ]) {
      expect(isBlockedInternalAbPath(p), `${p} must be blocked`).toBe(true);
    }
  });

  it("leaves every other path alone", () => {
    for (const p of [
      "/",
      "/about",
      "/abc.json",
      "/openlen",
      "/openlen/",
      "/openlen/abc",
      "/openlen/ab.jsonx",
      "/openlen/ab.json.map",
      "/openlen/figure-0a1b2c3d.js",
      "/x/openlen/ab.json",
      "/openlen/../about",
      "/ab/openlen/ab.json",
    ]) {
      expect(isBlockedInternalAbPath(p), `${p} must NOT be blocked`).toBe(false);
    }
  });

  it("a malformed percent sequence does not throw (it is judged as written)", () => {
    expect(isBlockedInternalAbPath("/openlen/ab.json%E0%A4%A")).toBe(false);
    expect(isBlockedInternalAbPath("/openlen/%E0%A4%A/ab.json")).toBe(false);
  });

  it("isInternalAbFile: only this release's openlen/ab.json and openlen/ab/**", () => {
    const rel = path.join(os.tmpdir(), "releases", "aaaa11112222");
    expect(isInternalAbFile(rel, path.join(rel, "openlen", "ab.json"))).toBe(true);
    expect(isInternalAbFile(rel, path.join(rel, "openlen", "ab", "ab_1", "b", "index.html"))).toBe(true);
    expect(isInternalAbFile(rel, path.join(rel, "OPENLEN", "AB.JSON"))).toBe(true);
    expect(isInternalAbFile(rel, path.join(rel, "openlen", "figure-0a1b2c3d.js"))).toBe(false);
    expect(isInternalAbFile(rel, path.join(rel, "index.html"))).toBe(false);
    // A site that is itself called ab (…/openlen/ab/current) is not blocked.
    const nested = path.join(os.tmpdir(), "openlen", "ab", "current");
    expect(isInternalAbFile(nested, path.join(nested, "index.html"))).toBe(false);
  });
});

// The same JSON file the Rust edge runs (crates/edge/src/ab/fixtures_test.rs): a case that passes
// there and fails here is a split between the edge and the custom-domain fallback.
describe("lib/ab/serve — the shared evaluate fixtures (parity with the Rust edge)", () => {
  type Case = {
    name: string;
    manifest: unknown;
    request: {
      path: string;
      query: string;
      cookie: string | null;
      ua: string;
      lang: string;
      ip: string;
      secure: boolean;
      nowMs: number;
    };
    expect: Record<string, unknown> | null;
  };
  const doc = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "crates", "edge", "tests", "fixtures", "ab", "evaluate.json"),
      "utf8",
    ),
  ) as { cases: Case[] };

  it("has the fixtures", () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(80);
  });

  for (const c of doc.cases) {
    it(c.name, () => {
      const m = c.manifest as { raw?: string };
      const manifest = parseAbManifest(typeof m.raw === "string" ? m.raw : JSON.stringify(c.manifest));
      const r = c.request;
      const got = manifest
        ? evaluateAbManifest(manifest, {
            urlPath: r.path,
            searchParams: new URLSearchParams(r.query),
            cookieHeader: r.cookie,
            userAgent: r.ua,
            acceptLanguage: r.lang,
            clientIp: r.ip,
            secureCookie: r.secure,
            nowMs: r.nowMs,
          })
        : null;
      if (c.expect === null) {
        expect(got).toBeNull();
        return;
      }
      expect(got).not.toBeNull();
      const actual: Record<string, unknown> = { ...got };
      for (const [key, want] of Object.entries(c.expect)) {
        expect(actual[key], key).toEqual(want);
      }
    });
  }
});

describe("lib/ab/serve — the manifest cache and the headers of a decided file", () => {
  const MANIFEST_JSON = JSON.stringify({
    version: 1,
    overrides: ["/css/site.css"],
    experiments: [
      {
        id: "ab_9f3c2a1b",
        cookieName: "ol_ab_9f3c2a1b",
        targetPath: "/",
        splitBps: 5000,
        salt: "3f9a1c8e7b2d4012",
        prefixB: "openlen/ab/ab_9f3c2a1b/b",
      },
    ],
  });

  /** The cache's door to the disk, counting what it is asked. */
  function fakeIo(files: Record<string, string>) {
    const calls = { realpath: 0, stat: 0, readFile: 0 };
    const mtimes: Record<string, number> = {};
    const failures: { stat?: NodeJS.ErrnoException; readFile?: NodeJS.ErrnoException } = {};
    const io = {
      async realpath(p: string) {
        calls.realpath++;
        return p.replace(/current$/, "releases/aaaa11112222");
      },
      async stat(p: string) {
        calls.stat++;
        if (failures.stat) throw failures.stat;
        const body = files[p];
        if (body === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return { isFile: () => true, size: body.length, mtimeMs: mtimes[p] ?? 1 };
      },
      async readFile(p: string) {
        calls.readFile++;
        if (failures.readFile) throw failures.readFile;
        return files[p]!;
      },
    };
    return { io, calls, mtimes, failures, files };
  }
  const AB_FILE = path.join("/srv", "demo", "releases", "aaaa11112222", "openlen", "ab.json");

  it("reads a release once, then answers from memory while the file is unchanged", async () => {
    const f = fakeIo({ [AB_FILE]: MANIFEST_JSON });
    const cache = new ReleaseAbManifestCache({ maxEntries: 10, maxBytes: 1 << 20 }, f.io);
    for (let i = 0; i < 3; i++) {
      const got = await cache.get("/srv/demo/current");
      expect(got.manifest?.experiments).toHaveLength(1);
      // The manifest AND the directory files are served from are the resolved release.
      expect(got.dir).toBe(path.join("/srv", "demo", "releases", "aaaa11112222"));
    }
    expect(f.calls.readFile).toBe(1);
    // Edited in place (a plain directory in dev): the signature moves, so it is read again.
    f.mtimes[AB_FILE] = 2;
    await cache.get("/srv/demo/current");
    expect(f.calls.readFile).toBe(2);
  });

  it("remembers that a release has no experiment, without reading anything", async () => {
    const f = fakeIo({});
    const cache = new ReleaseAbManifestCache({ maxEntries: 10, maxBytes: 1 << 20 }, f.io);
    for (let i = 0; i < 3; i++) expect((await cache.get("/srv/demo/current")).manifest).toBeNull();
    expect(f.calls.readFile).toBe(0);
  });

  it("never caches a transient error: the next request reads the file again", async () => {
    const f = fakeIo({ [AB_FILE]: MANIFEST_JSON });
    const cache = new ReleaseAbManifestCache({ maxEntries: 10, maxBytes: 1 << 20 }, f.io);
    f.failures.readFile = Object.assign(new Error("EIO"), { code: "EIO" });
    expect((await cache.get("/srv/demo/current")).manifest).toBeNull();
    f.failures.readFile = undefined;
    expect((await cache.get("/srv/demo/current")).manifest).not.toBeNull();
    // Same for a failing stat.
    const g = fakeIo({ [AB_FILE]: MANIFEST_JSON });
    const cache2 = new ReleaseAbManifestCache({ maxEntries: 10, maxBytes: 1 << 20 }, g.io);
    g.failures.stat = Object.assign(new Error("EACCES"), { code: "EACCES" });
    expect((await cache2.get("/srv/demo/current")).manifest).toBeNull();
    g.failures.stat = undefined;
    expect((await cache2.get("/srv/demo/current")).manifest).not.toBeNull();
  });

  it("is bounded by entries and by bytes", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      files[path.join("/srv", `s${i}`, "releases", "aaaa11112222", "openlen", "ab.json")] = MANIFEST_JSON;
    }
    const f = fakeIo(files);
    const byCount = new ReleaseAbManifestCache({ maxEntries: 5, maxBytes: 1 << 30 }, f.io);
    const byBytes = new ReleaseAbManifestCache({ maxEntries: 1000, maxBytes: 3 * MANIFEST_JSON.length }, f.io);
    for (let i = 0; i < 30; i++) {
      await byCount.get(`/srv/s${i}/current`);
      await byBytes.get(`/srv/s${i}/current`);
    }
    expect(byCount.size).toBeLessThanOrEqual(5);
    expect(byBytes.size).toBeLessThan(10);
    expect(byBytes.bytes).toBeLessThanOrEqual(3 * MANIFEST_JSON.length);
  });

  it("a decided file is no-store for everyone, with no validator", () => {
    const asset = {
      experimentId: "ab_9f3c2a1b",
      variant: "a" as const,
      source: "cookie" as const,
      variantBPath: null,
      setCookie: null,
      isOverride: false,
      isPageRoute: false,
    };
    const h = abResponseHeaders(asset, 99);
    expect(h["Cache-Control"]).toBe("no-store");
    expect(h["Vary"]).toBe("Cookie");
    expect(h["X-OpenLen-AB"]).toBe("ab_9f3c2a1b:a");
    expect(h["ETag"]).toBeUndefined();
    // A page keeps its own policy.
    expect(abResponseHeaders({ ...asset, isPageRoute: true }, 99)["Cache-Control"]).toBe("private, no-store");
  });
});
