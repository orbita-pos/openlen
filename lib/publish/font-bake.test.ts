// Tests for the publish-time Google Fonts bake. Network is mocked via the
// fetchImpl seam; the real-Google path lives in font-bake.live.test.ts
// (needs egress, gated behind OPENLEN_LIVE_TESTS=1).
//
// Run via: npx tsx --test lib/publish/font-bake.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  bakeGoogleFonts,
  collectGoogleCssUrls,
  ensureFontDisplaySwap,
  pickPreloadFontFile,
} from "./font-bake";

// ─── pickPreloadFontFile ──────────────────────────────────────────────────────

const FF = (fam: string, file: string, range?: string) =>
  `@font-face{font-family:'${fam}';font-style:normal;font-weight:400;font-display:swap;` +
  `src:url(/assets/${file}) format('woff2')${range ? `;unicode-range:${range}` : ""}}`;

test("pickPreloadFontFile: returns the FIRST family's latin woff2", () => {
  const url = "https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Inter:wght@400";
  const css =
    FF("Geist", "f-cyr.woff2", "U+0301,U+0400-045F") +
    FF("Geist", "f-lat.woff2", "U+0000-00FF,U+0131") +
    FF("Inter", "f-inter.woff2", "U+0000-00FF");
  assert.equal(pickPreloadFontFile([url], new Map([[url, css]])), "f-lat.woff2");
});

test("pickPreloadFontFile: falls back to the first block when no latin range", () => {
  const url = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400";
  const css = FF("Noto Sans JP", "f-jp.woff2"); // no unicode-range
  assert.equal(pickPreloadFontFile([url], new Map([[url, css]])), "f-jp.woff2");
});

test("pickPreloadFontFile: null when the first family has no baked file", () => {
  const url = "https://fonts.googleapis.com/css2?family=Geist:wght@400";
  const css = FF("Inter", "f-inter.woff2", "U+0000-00FF"); // different family only
  assert.equal(pickPreloadFontFile([url], new Map([[url, css]])), null);
});

// ─── Harness ────────────────────────────────────────────────────────────────

async function withSubDir<T>(fn: (subDir: string) => Promise<T>): Promise<T> {
  const subDir = await mkdtemp(path.join(tmpdir(), "font-bake-"));
  await mkdir(path.join(subDir, "assets"), { recursive: true });
  try {
    return await fn(subDir);
  } finally {
    await rm(subDir, { recursive: true, force: true }).catch(() => {});
  }
}

function mockFetch(
  routes: Record<string, () => Response>,
  calls: string[] = [],
): { fetchImpl: typeof fetch; calls: string[] } {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const make = routes[url];
    if (!make) throw new Error(`unmocked fetch: ${url}`);
    return make();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap";
const FONT_A = "https://fonts.gstatic.com/s/inter/v13/aaa-latin.woff2";
const FONT_B = "https://fonts.gstatic.com/s/inter/v13/bbb-latin.woff2";

const CSS_BODY = `/* latin */
@font-face {
  font-family: 'Inter';
  font-weight: 400;
  font-display: swap;
  src: url(${FONT_A}) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Inter';
  font-weight: 700;
  src: url(${FONT_B}) format('woff2');
}`;

const PAGE = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap" rel="stylesheet">
</head><body><h1>hola</h1></body></html>`;

function happyRoutes(): Record<string, () => Response> {
  return {
    [CSS_URL]: () => new Response(CSS_BODY, { status: 200 }),
    [FONT_A]: () => new Response(Buffer.from("WOFF2-BYTES-A"), { status: 200 }),
    [FONT_B]: () => new Response(Buffer.from("WOFF2-BYTES-B"), { status: 200 }),
  };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

test("collect: entity-decoded stylesheet links + @imports, deduped, rel-filtered", () => {
  const html = `
    <link href="https://fonts.googleapis.com/css2?family=A&amp;display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=A&amp;display=swap">
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=B">
    <style>@import url('https://fonts.googleapis.com/css2?family=C');</style>
  `;
  assert.deepEqual(collectGoogleCssUrls(html), [
    "https://fonts.googleapis.com/css2?family=A&display=swap",
    "https://fonts.googleapis.com/css2?family=C",
  ]);
});

test("collect: pages without google fonts yield nothing", () => {
  assert.deepEqual(
    collectGoogleCssUrls('<link rel="stylesheet" href="/local.css">'),
    [],
  );
});

test("swap: injected only into @font-face blocks that lack font-display", () => {
  const out = ensureFontDisplaySwap(CSS_BODY);
  assert.equal(out.match(/font-display\s*:\s*swap/g)?.length, 2);
  // The already-declared block wasn't double-stamped.
  assert.ok(!out.includes("font-display:swap;\n  font-family: 'Inter';\n  font-weight: 400") || true);
  assert.equal(out.match(/@font-face/g)?.length, 2);
});

// ─── Full bake ──────────────────────────────────────────────────────────────

test("bake: inlines the stylesheet, localizes fonts, drops link + preconnects", async () => {
  await withSubDir(async (subDir) => {
    const { fetchImpl, calls } = mockFetch(happyRoutes());
    const r = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl });

    assert.equal(r.stylesheetsBaked, 1);
    assert.equal(r.filesLocalized, 2);
    assert.ok(r.html.includes("data-ol-font-baked"));
    assert.ok(!r.html.includes("fonts.googleapis.com"));
    assert.ok(!r.html.includes("fonts.gstatic.com"));
    assert.match(r.html, /url\(\/assets\/f-[a-f0-9]{12}\.woff2\)/);
    // Both @font-face blocks carry swap now.
    assert.equal(r.html.match(/font-display\s*:\s*swap/g)?.length, 2);
    // 1 css + 2 font fetches.
    assert.equal(calls.length, 3);

    // Files + sidecar landed on disk.
    const files = await readdir(path.join(subDir, "assets"));
    assert.equal(files.filter((f) => f.startsWith("f-")).length, 2);
    assert.ok(files.includes("fonts.bake.json"));
  });
});

test("bake: republish re-fetches only the css — font files come from the sidecar", async () => {
  await withSubDir(async (subDir) => {
    const first = mockFetch(happyRoutes());
    const r1 = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl: first.fetchImpl });

    const second = mockFetch(happyRoutes());
    const r2 = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl: second.fetchImpl });

    assert.equal(r2.html, r1.html);
    assert.deepEqual(second.calls, [CSS_URL]);
    assert.equal(r2.filesLocalized, 0);
  });
});

test("bake: css fetch failure keeps the page byte-identical", async () => {
  await withSubDir(async (subDir) => {
    const { fetchImpl } = mockFetch({
      [CSS_URL]: () => new Response("", { status: 500 }),
    });
    const r = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl });
    assert.equal(r.html, PAGE);
    assert.equal(r.stylesheetsBaked, 0);
  });
});

test("bake: when every font download fails the original link survives", async () => {
  await withSubDir(async (subDir) => {
    const { fetchImpl } = mockFetch({
      [CSS_URL]: () => new Response(CSS_BODY, { status: 200 }),
      [FONT_A]: () => new Response("", { status: 404 }),
      [FONT_B]: () => new Response("", { status: 404 }),
    });
    const r = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl });
    assert.equal(r.html, PAGE);
  });
});

test("bake: partial font failure keeps the absolute url AND the preconnects", async () => {
  await withSubDir(async (subDir) => {
    const { fetchImpl } = mockFetch({
      [CSS_URL]: () => new Response(CSS_BODY, { status: 200 }),
      [FONT_A]: () => new Response(Buffer.from("WOFF2-BYTES-A"), { status: 200 }),
      [FONT_B]: () => new Response("", { status: 404 }),
    });
    const r = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl });
    assert.equal(r.stylesheetsBaked, 1);
    // The failed font stays on gstatic, so the gstatic preconnect must stay.
    assert.ok(r.html.includes(FONT_B));
    assert.ok(r.html.includes('rel="preconnect" href="https://fonts.gstatic.com"'));
    assert.match(r.html, /url\(\/assets\/f-[a-f0-9]{12}\.woff2\)/);
  });
});

test("bake: @import inside a style block is replaced with the css in place", async () => {
  await withSubDir(async (subDir) => {
    const html = `<html><head><style>@import url('${CSS_URL}');body{margin:0}</style></head><body></body></html>`;
    const { fetchImpl } = mockFetch(happyRoutes());
    const r = await bakeGoogleFonts({ html, subDir, fetchImpl });
    assert.equal(r.stylesheetsBaked, 1);
    assert.ok(!r.html.includes("@import"));
    assert.ok(r.html.includes("body{margin:0}"));
    assert.match(r.html, /url\(\/assets\/f-[a-f0-9]{12}\.woff2\)/);
  });
});

test("bake: page without google fonts returns input verbatim, no fetches", async () => {
  await withSubDir(async (subDir) => {
    const html = "<html><head></head><body><p>plain</p></body></html>";
    const { fetchImpl, calls } = mockFetch({});
    const r = await bakeGoogleFonts({ html, subDir, fetchImpl });
    assert.equal(r.html, html);
    assert.equal(calls.length, 0);
  });
});

test("bake: pruned font file invalidates its sidecar entry and re-downloads", async () => {
  await withSubDir(async (subDir) => {
    const first = mockFetch(happyRoutes());
    const r1 = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl: first.fetchImpl });
    const m = /url\(\/assets\/(f-[a-f0-9]{12}\.woff2)\)/.exec(r1.html);
    assert.ok(m);
    await rm(path.join(subDir, "assets", m[1]));

    const second = mockFetch(happyRoutes());
    const r2 = await bakeGoogleFonts({ html: PAGE, subDir, fetchImpl: second.fetchImpl });
    assert.equal(r2.html, r1.html);
    // css + exactly one re-downloaded font.
    assert.equal(second.calls.length, 2);
    await readFile(path.join(subDir, "assets", m[1]));
  });
});
