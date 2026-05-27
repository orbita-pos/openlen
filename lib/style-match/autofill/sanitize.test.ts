// Tests for the migrated lib/style-match/autofill/sanitize.ts — verify the
// public contract `sanitizeFilledHtml` is preserved under the default
// `shadow-prefer-ts` mode AND that flipping to `rust` mode produces the
// adapted Rust output that respects the same TS-shape contract.
//
// Run via: npx tsx --test lib/style-match/autofill/sanitize.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { sanitizeFilledHtml } from "./sanitize";

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T,
): T {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prior[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prior)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

// All shadow-soak warnings emit to console.warn. Silence them per test by
// temporarily replacing the global console.warn — we don't want to validate
// the log format here (shadow-soak.test.ts owns that).
function quiet<T>(fn: () => T): T {
  const orig = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = orig;
  }
}

// ─── Default mode (shadow-prefer-ts): legacy TS behaviour preserved ───────

test("default mode: empty input → zero counters (legacy cheerio normalises to wrap)", () => {
  // cheerio.load("").html() emits `<html><head></head><body></body></html>` —
  // we don't assert byte-equal here because the Rust impl preserves empty,
  // and the shadow-soak warning surfaces the divergence intentionally. What
  // we ARE testing: the counters are zero (no XSS-shaped content stripped).
  const r = quiet(() => sanitizeFilledHtml(""));
  assert.equal(r.removed.scripts, 0);
  assert.equal(r.removed.eventHandlers, 0);
  assert.equal(r.removed.dangerousUrls, 0);
  assert.equal(r.removed.iframes, 0);
});

test("default mode: clean HTML passes through", () => {
  const html = "<div class=\"card\"><h1>Title</h1><p>body</p></div>";
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(r.html.includes("Title"));
  assert.ok(r.html.includes("body"));
  assert.equal(r.removed.scripts, 0);
});

test("default mode: inline <script> stripped", () => {
  const html = "<div><script>alert('xss')</script><p>safe</p></div>";
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(!r.html.includes("<script>"));
  assert.ok(r.html.includes("<p>safe</p>"));
  assert.equal(r.removed.scripts, 1);
});

test("default mode: Tailwind CDN script preserved (whitelist)", () => {
  const html =
    '<head><script src="https://cdn.tailwindcss.com"></script></head>';
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(r.html.includes("cdn.tailwindcss.com"));
  assert.equal(r.removed.scripts, 0);
});

test("default mode: onclick + onmouseover event handlers stripped", () => {
  const html = '<button onclick="x()" onmouseover="y()">go</button>';
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(!r.html.toLowerCase().includes("onclick"));
  assert.ok(!r.html.toLowerCase().includes("onmouseover"));
  assert.equal(r.removed.eventHandlers, 2);
});

test("default mode: iframe + object + embed removed", () => {
  const html =
    '<div><iframe src="x"></iframe><object data="y"></object><embed src="z"></div>';
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(!r.html.includes("<iframe"));
  assert.ok(!r.html.includes("<object"));
  assert.ok(!r.html.includes("<embed"));
  assert.equal(r.removed.iframes, 3);
});

test("default mode: javascript: href stripped", () => {
  const html = '<a href="javascript:alert(1)">x</a>';
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(!r.html.toLowerCase().includes("javascript:"));
  assert.equal(r.removed.dangerousUrls, 1);
});

test("default mode: vbscript: action stripped", () => {
  const html = '<form action="vbscript:bad()"><input/></form>';
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(!r.html.toLowerCase().includes("vbscript:"));
  assert.equal(r.removed.dangerousUrls, 1);
});

test("default mode: meta-refresh counted as scripts (legacy TS contract)", () => {
  const html = '<head><meta http-equiv="refresh" content="0;url=evil.com"></head>';
  const r = quiet(() => sanitizeFilledHtml(html));
  // TS contract bundles meta-refresh into `scripts`. The Rust adapter
  // re-bundles for the shadow comparison, but the public counter the
  // caller observes is `scripts` either way.
  assert.equal(r.removed.scripts, 1);
});

test("default mode: meta http-equiv=set-cookie removed", () => {
  const html =
    '<head><meta http-equiv="set-cookie" content="session=hijack"></head>';
  const r = quiet(() => sanitizeFilledHtml(html));
  assert.ok(!r.html.toLowerCase().includes("set-cookie"));
  assert.equal(r.removed.scripts, 1);
});

// ─── Force TS mode (cutover dry-run reverse): same as default ──────────────

test("forced ts mode: matches default behaviour", () => {
  withEnv({ OPENLEN_SHADOW_SANITIZE_FILLED_HTML: "ts" }, () => {
    const r = sanitizeFilledHtml('<div><script>x</script></div>');
    assert.ok(!r.html.includes("<script>"));
    assert.equal(r.removed.scripts, 1);
  });
});

// ─── Force RUST mode (cutover dry-run forward): adapted shape ──────────────

test("forced rust mode: counters bundle metaRefresh into scripts (adapter)", () => {
  withEnv({ OPENLEN_SHADOW_SANITIZE_FILLED_HTML: "rust" }, () => {
    const r = sanitizeFilledHtml('<head><meta http-equiv="refresh" content="0"></head>');
    // Rust splits meta-refresh into its own counter; the adapter re-bundles
    // it into `scripts` to match the TS contract. So scripts === 1.
    assert.equal(r.removed.scripts, 1);
    assert.equal(r.removed.eventHandlers, 0);
  });
});

test("forced rust mode: still strips scripts + handlers + urls", () => {
  withEnv({ OPENLEN_SHADOW_SANITIZE_FILLED_HTML: "rust" }, () => {
    const r = sanitizeFilledHtml(
      '<a href="javascript:1" onclick="x()">hi</a><script>x</script>',
    );
    assert.ok(!r.html.toLowerCase().includes("javascript:"));
    assert.ok(!r.html.toLowerCase().includes("onclick"));
    assert.ok(!r.html.includes("<script"));
    assert.equal(r.removed.scripts, 1);
    assert.equal(r.removed.eventHandlers, 1);
    assert.equal(r.removed.dangerousUrls, 1);
  });
});

test("forced rust mode: data-slot-path input throws (adapter contract)", () => {
  withEnv({ OPENLEN_SHADOW_SANITIZE_FILLED_HTML: "rust" }, () => {
    assert.throws(
      () => sanitizeFilledHtml('<div data-slot-path="hero.title">x</div>'),
      /sanitize gate fired/,
    );
  });
});

// ─── Adversarial smoke (light — full 1000-doc corpus is in Rust crate) ────

test("default mode: prompt-injection-style mixed payload", () => {
  const evil = [
    "<div>",
    '<script>fetch("/steal")</script>',
    '<a href="javascript:alert(1)">tap</a>',
    '<button onclick="exfil()">x</button>',
    '<iframe src="https://attacker"></iframe>',
    '<img src="x" onerror="bad()">',
    '<meta http-equiv="refresh" content="0;url=attacker">',
    "</div>",
  ].join("");
  const r = quiet(() => sanitizeFilledHtml(evil));
  // All XSS-shaped content stripped, design-bearing markup preserved.
  assert.ok(!r.html.toLowerCase().includes("<script"));
  assert.ok(!r.html.toLowerCase().includes("javascript:"));
  assert.ok(!r.html.toLowerCase().includes("onclick"));
  assert.ok(!r.html.toLowerCase().includes("onerror"));
  assert.ok(!r.html.toLowerCase().includes("<iframe"));
  assert.ok(!r.html.toLowerCase().includes("http-equiv"));
  assert.ok(r.removed.scripts >= 2, "script + meta-refresh both count");
  assert.ok(r.removed.eventHandlers >= 2, "onclick + onerror");
  assert.ok(r.removed.dangerousUrls >= 1);
  assert.ok(r.removed.iframes >= 1);
});
