import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { optimizeForPublish } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

test("empty input → empty output", () => {
  const r = optimizeForPublish("");
  assert.equal(r.html, "");
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.bytesIn, 0);
  assert.equal(r.stats.bytesOut, 0);
});

test("simple HTML gets reduced + idempotent", () => {
  const html = "<!doctype html>\n<html>\n  <body>\n    <p>hello</p>\n  </body>\n</html>\n";
  const r1 = optimizeForPublish(html);
  assert.deepEqual(r1.errors, []);
  assert.ok(r1.html != null);
  assert.ok(r1.html.length < html.length, `expected reduction, got ${r1.html.length} >= ${html.length}`);
  // Stats match what we measured.
  assert.equal(r1.stats.bytesIn, html.length);
  assert.equal(r1.stats.bytesOut, r1.html.length);
  // Bake fields are 0/false (Sem 8 Option C — bake deferred).
  assert.equal(r1.stats.cssInlined, false);
  assert.equal(r1.stats.tailwindClassesKept, 0);

  // Idempotent.
  const r2 = optimizeForPublish(r1.html);
  assert.equal(r2.html, r1.html);
});

test("data-slot-path literal is rejected (html absent)", () => {
  const r = optimizeForPublish('<div data-slot-path="hero.title">x</div>');
  // napi-rs serializes None as absent property — see S1 handoff note;
  // treat absence the same as null at every call site.
  assert.ok(r.html == null, `expected html absent, got ${r.html}`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /data-slot-path/);
  // bytes_in still reported so the caller can log it.
  assert.equal(r.stats.bytesIn, '<div data-slot-path="hero.title">x</div>'.length);
  assert.equal(r.stats.bytesOut, 0);
});

test("Tailwind CDN is intentionally preserved (bake deferred)", () => {
  const html =
    '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-red-500">x</body></html>';
  const r = optimizeForPublish(html);
  assert.ok(r.html != null);
  assert.match(r.html, /cdn\.tailwindcss\.com/);
  assert.equal(r.stats.cssInlined, false);
  assert.equal(r.stats.tailwindClassesKept, 0);
});

test("arbitrary-value Tailwind classes survive intact", () => {
  const html =
    '<div class="bg-[rgba(15,15,15,0.72)] max-w-[1240px] text-[color:var(--fg-dim)]">x</div>';
  const r = optimizeForPublish(html);
  assert.ok(r.html != null);
  assert.match(r.html, /bg-\[rgba\(15,15,15,0\.72\)\]/);
  assert.match(r.html, /max-w-\[1240px\]/);
});

test("counter.html starter: reduction + idempotence", () => {
  const src = starter("counter.html");
  const r1 = optimizeForPublish(src);
  assert.deepEqual(r1.errors, []);
  assert.ok(r1.html != null);
  // ≥15% reduction (achievable floor; F1 plan called for 20% but that
  // depends on the deferred Tailwind bake — see optimize_starters.rs).
  const pct = (1 - r1.html.length / src.length) * 100;
  assert.ok(pct >= 15, `counter reduction ${pct.toFixed(1)}% below 15%`);
  // Idempotence.
  const r2 = optimizeForPublish(r1.html);
  assert.equal(r2.html, r1.html);
});

test("manuscript.html starter: reduction (≥11%, denser) + idempotence", () => {
  const src = starter("manuscript.html");
  const r1 = optimizeForPublish(src);
  assert.deepEqual(r1.errors, []);
  assert.ok(r1.html != null);
  const pct = (1 - r1.html.length / src.length) * 100;
  // manuscript has the lowest whitespace by raw byte count; threshold
  // is correspondingly lower than counter/mirror. Threshold recalibrated
  // from 12.0% to 11.0% mirroring c1a7494 (the Rust-test twin), after the
  // S4 .gitattributes LF pin dropped the source from 38 091 → 37 576 bytes
  // while minify output stayed at 33 113.
  assert.ok(pct >= 11, `manuscript reduction ${pct.toFixed(1)}% below 11%`);
  const r2 = optimizeForPublish(r1.html);
  assert.equal(r2.html, r1.html);
});

test("mirror.html starter: reduction + idempotence", () => {
  const src = starter("mirror.html");
  const r1 = optimizeForPublish(src);
  assert.deepEqual(r1.errors, []);
  assert.ok(r1.html != null);
  const pct = (1 - r1.html.length / src.length) * 100;
  assert.ok(pct >= 12, `mirror reduction ${pct.toFixed(1)}% below 12%`);
  // Idempotence.
  const r2 = optimizeForPublish(r1.html);
  assert.equal(r2.html, r1.html);
});

// optimize must never delete inline JS — that is sanitize's job at publish.
// (mirror used to carry this via its sparkline <script>; it now ships static.)
test("optimize preserves inline <script> bodies", () => {
  const src =
    '<!doctype html><html><body><p>hi</p><script>window.__spark=1</script></body></html>';
  const r = optimizeForPublish(src);
  assert.deepEqual(r.errors, []);
  assert.ok(
    r.html.includes("window.__spark"),
    "inline script body must survive optimize",
  );
});

test("idempotence on already-minified output (round-trip)", () => {
  const html =
    '<!doctype html><html><body><p>x</p><p>y</p></body></html>';
  const r1 = optimizeForPublish(html).html;
  const r2 = optimizeForPublish(r1).html;
  const r3 = optimizeForPublish(r2).html;
  assert.equal(r1, r2);
  assert.equal(r2, r3);
});

test("composition: sanitize then optimize is stable", async () => {
  // The publish path will eventually chain sanitize → optimize (Sem 10
  // wiring). Even though Sem 8 doesn't wire it, the two passes must
  // compose: optimize(sanitize(x)) byte-equal optimize(sanitize(optimize(sanitize(x)))).
  const { sanitizeForPublish } = await import("../index.js");
  const html =
    '<div onclick="evil()"><script>bad()</script><p class="bg-[#333]">hi</p></div>';
  const s1 = sanitizeForPublish(html);
  assert.ok(s1.html != null);
  const o1 = optimizeForPublish(s1.html);
  assert.ok(o1.html != null);
  // Reapplying does nothing new.
  const s2 = sanitizeForPublish(o1.html);
  assert.ok(s2.html != null);
  const o2 = optimizeForPublish(s2.html);
  assert.equal(o2.html, o1.html);
});
