// Tests for sanitizeFilledHtml — the autofill-output sanitizer that strips
// scripts (except the whitelisted Tailwind CDN), iframe/object/embed,
// on*= event handlers, dangerous URL schemes, and meta-refresh / set-cookie
// redirects, while preserving the design-bearing HTML.
//
// Backed by Rust's `sanitize_for_publish` since F1 S9.
//
// Run via: npx tsx --test lib/style-match/autofill/sanitize.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { sanitizeFilledHtml } from "./sanitize";

test("empty input → zero counters", () => {
  const r = sanitizeFilledHtml("");
  assert.equal(r.removed.scripts, 0);
  assert.equal(r.removed.eventHandlers, 0);
  assert.equal(r.removed.dangerousUrls, 0);
  assert.equal(r.removed.iframes, 0);
});

test("clean HTML passes through", () => {
  const html = "<div class=\"card\"><h1>Title</h1><p>body</p></div>";
  const r = sanitizeFilledHtml(html);
  assert.ok(r.html.includes("Title"));
  assert.ok(r.html.includes("body"));
  assert.equal(r.removed.scripts, 0);
});

test("inline <script> stripped; Tailwind CDN whitelist preserved", () => {
  const html =
    '<head><script src="https://cdn.tailwindcss.com"></script><script>alert(1)</script></head>';
  const r = sanitizeFilledHtml(html);
  assert.ok(r.html.includes("cdn.tailwindcss.com"));
  assert.ok(!/<script>alert/.test(r.html));
  assert.equal(r.removed.scripts, 1);
});

test("onclick + onmouseover event handlers stripped", () => {
  const html = '<button onclick="x()" onmouseover="y()">go</button>';
  const r = sanitizeFilledHtml(html);
  assert.ok(!r.html.toLowerCase().includes("onclick"));
  assert.ok(!r.html.toLowerCase().includes("onmouseover"));
  assert.equal(r.removed.eventHandlers, 2);
});

test("iframe + object + embed removed", () => {
  const html =
    '<div><iframe src="x"></iframe><object data="y"></object><embed src="z"></div>';
  const r = sanitizeFilledHtml(html);
  assert.ok(!r.html.includes("<iframe"));
  assert.ok(!r.html.includes("<object"));
  assert.ok(!r.html.includes("<embed"));
  assert.equal(r.removed.iframes, 3);
});

test("javascript: + vbscript: URLs stripped", () => {
  const html =
    '<a href="javascript:alert(1)">x</a><form action="vbscript:bad()"></form>';
  const r = sanitizeFilledHtml(html);
  assert.ok(!r.html.toLowerCase().includes("javascript:"));
  assert.ok(!r.html.toLowerCase().includes("vbscript:"));
  assert.equal(r.removed.dangerousUrls, 2);
});

test("meta-refresh + set-cookie bundled into scripts counter (TS contract)", () => {
  // Rust splits meta-refresh into its own counter; the wrapper re-bundles
  // both meta-equiv removals (refresh + set-cookie) into `scripts` so the
  // public counters stay one-for-one with the legacy contract.
  const html =
    '<head><meta http-equiv="refresh" content="0;url=evil.com"><meta http-equiv="set-cookie" content="session=hijack"></head>';
  const r = sanitizeFilledHtml(html);
  assert.ok(!r.html.toLowerCase().includes("http-equiv"));
  assert.equal(r.removed.scripts, 2);
});

test("data-slot-path input throws (editor marker leaked into autofill)", () => {
  assert.throws(
    () => sanitizeFilledHtml('<div data-slot-path="hero.title">x</div>'),
    /sanitize gate fired/,
  );
});

test("adversarial mixed payload: every XSS shape stripped, counters add up", () => {
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
  const r = sanitizeFilledHtml(evil);
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
