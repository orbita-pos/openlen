// Tests for optimizeHtmlForProduction — publish-time Tailwind bake + Rust
// `optimize_for_publish` minify. The bake (revived) strips the render-blocking
// `cdn.tailwindcss.com` runtime and inlines the page's minimal CSS; the Rust
// pass then minifies HTML + the injected <style>. `bakeTailwind` is tested in
// isolation (no Rust, no env) since it's the pure new logic.
//
// Run via: npx tsx --test lib/publish/optimize-html.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { optimizeHtmlForProduction, bakeTailwind } from "./optimize-html";

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prior[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(prior)) {
        if (prior[k] === undefined) delete process.env[k];
        else process.env[k] = prior[k];
      }
    });
}

const TINY_DOC = "<!doctype html><html><body><p>hi</p></body></html>";
const DOC_WITH_CDN =
  '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4 text-lg">hello</div></body></html>';
const DOC_WITH_SLOT_PATH =
  '<!doctype html><html><body><div data-slot-path="hero.title">x</div></body></html>';

// ─── Dev-mode passthrough (NODE_ENV !== "production") ────────────────────────

test("dev mode: passthrough — html unchanged, baked false, cssBytes 0", async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    const r = await optimizeHtmlForProduction(DOC_WITH_CDN);
    assert.equal(r.html, DOC_WITH_CDN);
    assert.equal(r.baked, false);
    assert.equal(r.cssBytes, 0);
  });
});

test("dev mode: slot-path input is NOT gated here (upstream's job)", async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    const r = await optimizeHtmlForProduction(DOC_WITH_SLOT_PATH);
    assert.equal(r.html, DOC_WITH_SLOT_PATH);
    assert.equal(r.baked, false);
  });
});

// ─── Production mode (NODE_ENV=production) ────────────────────────────────────

test("prod mode: empty input → adapter returns empty/near-empty, no throw", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const r = await optimizeHtmlForProduction("");
    assert.equal(typeof r.html, "string");
    assert.equal(r.baked, false);
    assert.equal(r.cssBytes, 0);
  });
});

test("prod mode: tiny doc → minified output (<= input length)", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const r = await optimizeHtmlForProduction(TINY_DOC);
    assert.equal(typeof r.html, "string");
    assert.ok(r.html.length > 0);
    assert.ok(
      r.html.length <= TINY_DOC.length,
      `expected Rust output (${r.html.length}) <= input (${TINY_DOC.length}) post-minify`,
    );
    assert.equal(r.baked, false);
    assert.equal(r.cssBytes, 0);
  });
});

test("prod mode: doc with Tailwind CDN script — baked out, CDN stripped", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const r = await optimizeHtmlForProduction(DOC_WITH_CDN);
    // The bake replaces the render-blocking CDN runtime with inline CSS.
    assert.ok(!r.html.includes("cdn.tailwindcss.com"), "CDN script stripped");
    assert.ok(r.html.includes(".text-lg"), "used utility inlined");
    assert.equal(r.baked, true);
    assert.ok(r.cssBytes > 0);
  });
});

test("prod mode: slot-path input throws via gate", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      () => optimizeHtmlForProduction(DOC_WITH_SLOT_PATH),
      /optimize gate fired \(slot-path detected\)/,
    );
  });
});

test("prod mode: mixed-case slot-path also throws (Rust gate stronger than includes)", async () => {
  const evil =
    '<!doctype html><html><body><div Data-Slot-Path="hero.title">x</div></body></html>';
  await withEnv({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      () => optimizeHtmlForProduction(evil),
      /optimize gate fired/,
    );
  });
});

test("prod mode: idempotent — running twice byte-equal", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const once = await optimizeHtmlForProduction(TINY_DOC);
    const twice = await optimizeHtmlForProduction(once.html);
    assert.equal(once.html, twice.html);
  });
});

test("prod mode: two calls with same input produce same output (no state leak)", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const a = await optimizeHtmlForProduction(TINY_DOC);
    const b = await optimizeHtmlForProduction(TINY_DOC);
    assert.equal(a.html, b.html);
  });
});

// ─── bakeTailwind (pure — no Rust, no env) ───────────────────────────────────

test("bake: strips CDN, inlines used utilities at end of <head>", async () => {
  const r = await bakeTailwind(DOC_WITH_CDN);
  assert.equal(r.baked, true);
  assert.ok(!r.html.includes("cdn.tailwindcss.com"), "CDN script removed");
  assert.ok(r.html.includes("<style data-tw-baked>"), "baked style injected");
  assert.ok(r.html.includes(".p-4"), "p-4 generated");
  assert.ok(r.html.includes(".text-lg"), "text-lg generated");
  assert.ok(r.cssBytes > 0);
  // Injected at end of head so utilities win specificity ties (CDN parity).
  assert.ok(
    r.html.indexOf("data-tw-baked") < r.html.indexOf("</head>"),
    "baked style is inside <head>",
  );
});

test("bake: arbitrary values survive (content-scanned, not purged)", async () => {
  const doc =
    '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="max-w-[1240px] text-[13px]">x</div></body></html>';
  const r = await bakeTailwind(doc);
  assert.equal(r.baked, true);
  assert.ok(r.html.includes("max-w-\\[1240px\\]"), "arbitrary max-w generated");
  assert.ok(r.html.includes("text-\\[13px\\]"), "arbitrary text size generated");
});

test("bake: no CDN script → passthrough, unchanged", async () => {
  const r = await bakeTailwind(TINY_DOC);
  assert.equal(r.baked, false);
  assert.equal(r.html, TINY_DOC);
  assert.equal(r.cssBytes, 0);
});

test("bake: ?plugins= CDN variant is left intact (plugin utils not reproducible)", async () => {
  const doc =
    '<!doctype html><html><head><script src="https://cdn.tailwindcss.com?plugins=forms,typography"></script></head><body><div class="p-4">x</div></body></html>';
  const r = await bakeTailwind(doc);
  assert.equal(r.baked, false);
  assert.ok(r.html.includes("cdn.tailwindcss.com?plugins="), "CDN kept");
  assert.equal(r.html, doc);
});

test("bake: idempotent — baking already-baked HTML is a no-op", async () => {
  const once = await bakeTailwind(DOC_WITH_CDN);
  const twice = await bakeTailwind(once.html);
  assert.equal(twice.baked, false);
  assert.equal(twice.html, once.html);
});
