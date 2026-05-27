// Tests for optimizeHtmlForProduction — publish-time HTML/CSS minify
// backed by Rust's `optimize_for_publish` since F1 S9. The Tailwind bake
// step was removed in F1 S9 (per soak data — Lighthouse impact is the
// operator's post-deploy check); published pages depend on the Tailwind
// CDN at render.
//
// Run via: npx tsx --test lib/publish/optimize-html.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { optimizeHtmlForProduction } from "./optimize-html";

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

test("prod mode: doc with Tailwind CDN script — CDN survives, no bake", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const r = await optimizeHtmlForProduction(DOC_WITH_CDN);
    // The Rust minify pass doesn't strip the CDN <script> — that was the
    // legacy TS bake's job. Published pages depend on the CDN at runtime.
    assert.ok(r.html.includes("cdn.tailwindcss.com"));
    assert.equal(r.baked, false);
    assert.equal(r.cssBytes, 0);
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
