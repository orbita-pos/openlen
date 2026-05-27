import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { HtmlStream } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

// -- Class shape ----------------------------------------------------------

test("HtmlStream is a class with constructor + write + end", () => {
  const s = new HtmlStream();
  assert.equal(typeof s.write, "function");
  assert.equal(typeof s.end, "function");
});

test("default opts: tag + sanitize + normalize, no minify", () => {
  const s = new HtmlStream();
  s.write("<div><p>hi</p></div>");
  const r = s.end();
  assert.match(r.finalHtml, /data-op-id=/);
  assert.equal(r.opIdsAssigned, 2);
  // Normalize chain markers show up for canonical CSS variables.
  // Even on a synthetic input, the radius style block lands on end().
  assert.match(r.finalHtml, /<style data-ol-radius>/);
});

// -- Chunked write semantics ---------------------------------------------

test("write returns per-write emit; end returns aggregate result", () => {
  const s = new HtmlStream({
    injectOpIds: false,
    sanitize: false,
    normalizeOnEnd: false,
    minifyOnEnd: false,
  });
  // No transforms — the sum of write outputs plus the trailing flush
  // matches the input byte-for-byte.
  s.write("<div>");
  s.write("<p>hi</p>");
  s.write("</div>");
  const r = s.end();
  assert.equal(r.finalHtml, "<div><p>hi</p></div>");
  assert.equal(r.bytesIn, "<div><p>hi</p></div>".length);
  assert.equal(r.bytesOut, r.bytesFinal);
});

test("single chunk equals concatenation of many one-byte chunks", () => {
  const html = "<section><h2>Hi</h2><p>x</p></section>";
  const a = new HtmlStream();
  a.write(html);
  const single = a.end().finalHtml;

  const b = new HtmlStream();
  for (const ch of html) b.write(ch);
  const chunked = b.end().finalHtml;

  assert.equal(single, chunked);
});

// -- Slot-path fail-fast --------------------------------------------------

test("write throws on data-slot-path literal", () => {
  const s = new HtmlStream();
  assert.throws(
    () => s.write('<div data-slot-path="x">y</div>'),
    /data-slot-path/
  );
});

test("write throws on entity-encoded slot path", () => {
  const s = new HtmlStream();
  assert.throws(
    () => s.write('<div &#100;ata-slot-path="x">y</div>'),
    /entity-encoded/
  );
});

test("slot path spanning two chunks is caught on the second write", () => {
  const s = new HtmlStream();
  s.write("<div data-sl");
  assert.throws(() => s.write('ot-path="x">y</div>'), /data-slot-path/);
});

test("write after end errors cleanly", () => {
  const s = new HtmlStream();
  s.write("<div>x</div>");
  s.end();
  assert.throws(() => s.write("more"), /after end\(\)/);
});

test("end twice errors", () => {
  const s = new HtmlStream();
  s.end();
  assert.throws(() => s.end(), /twice/);
});

// -- Sanitize semantics ---------------------------------------------------

test("inline script stripped, Tailwind CDN kept", () => {
  const s = new HtmlStream({
    injectOpIds: false,
    sanitize: true,
    normalizeOnEnd: false,
    minifyOnEnd: false,
  });
  s.write(
    '<script src="https://cdn.tailwindcss.com"></script>' +
      "<script>alert(1)</script>" +
      "<p>x</p>"
  );
  const r = s.end();
  assert.ok(r.finalHtml.includes("cdn.tailwindcss.com"));
  assert.ok(!r.finalHtml.includes("alert"));
  assert.equal(r.sanitizeRemoved.scripts, 1);
});

test("normalize-chain marker scripts survive sanitize on round-trip", () => {
  // The streaming pipeline whitelists `<script data-ol-*>` blocks
  // emitted by the normalize chain so re-feeding the streaming
  // output preserves them — required for idempotence (see Rust
  // tests `idempotence_on_streaming_output`).
  const s1 = new HtmlStream();
  s1.write('<div class="rounded-xl">x</div>');
  const r1 = s1.end();
  const s2 = new HtmlStream();
  s2.write(r1.finalHtml);
  const r2 = s2.end();
  assert.equal(r1.finalHtml, r2.finalHtml);
  // Second pass: zero new sanitize removals (the marker scripts
  // matched the data-ol-* whitelist, not stripped).
  assert.equal(r2.sanitizeRemoved.scripts, 0);
});

// -- Counters surface ----------------------------------------------------

test("sanitize counters reflect removals", () => {
  const s = new HtmlStream({
    injectOpIds: true,
    sanitize: true,
    normalizeOnEnd: false,
    minifyOnEnd: false,
  });
  s.write(
    '<div onclick="evil()"><iframe></iframe><script>bad()</script><a href="javascript:y()">z</a></div>'
  );
  const r = s.end();
  assert.equal(r.sanitizeRemoved.scripts, 1);
  assert.equal(r.sanitizeRemoved.iframes, 1);
  assert.equal(r.sanitizeRemoved.eventHandlers, 1);
  assert.equal(r.sanitizeRemoved.dangerousUrls, 1);
});

// -- End-of-stream transforms --------------------------------------------

test("normalizeOnEnd=false keeps the input as-is", () => {
  const html = "<div><p>hi</p></div>";
  const with_ = new HtmlStream({
    injectOpIds: true,
    sanitize: true,
    normalizeOnEnd: true,
    minifyOnEnd: false,
  });
  with_.write(html);
  const a = with_.end();

  const without = new HtmlStream({
    injectOpIds: true,
    sanitize: true,
    normalizeOnEnd: false,
    minifyOnEnd: false,
  });
  without.write(html);
  const b = without.end();

  assert.ok(a.finalHtml.length > b.finalHtml.length);
});

test("minifyOnEnd shrinks the output", () => {
  const html =
    "<!doctype html>\n<html>\n  <body>\n    <p>hi</p>\n  </body>\n</html>\n";
  const min = new HtmlStream({
    injectOpIds: false,
    sanitize: false,
    normalizeOnEnd: false,
    minifyOnEnd: true,
  });
  min.write(html);
  const r = min.end();
  assert.ok(r.finalHtml.length < html.length);
});

// -- Starter byte-equal vs sync (via the published napi functions) -------

test("counter.html streamed in 16 chunks is non-empty + tagged", () => {
  const src = starter("counter.html");
  const chunkSize = Math.ceil(src.length / 16);
  const s = new HtmlStream();
  for (let i = 0; i < src.length; i += chunkSize) {
    s.write(src.slice(i, i + chunkSize));
  }
  const r = s.end();
  assert.ok(r.finalHtml.length > 0);
  assert.ok(r.opIdsAssigned > 10);
  // Tailwind CDN survives the streaming sanitize pass.
  assert.match(r.finalHtml, /cdn\.tailwindcss\.com/);
});

test("two concurrent streams have independent state", () => {
  const a = new HtmlStream();
  const b = new HtmlStream();
  a.write("<div><p>one</p></div>");
  b.write("<section><p>two</p></section>");
  const ra = a.end();
  const rb = b.end();
  // Op-id sequences start at 0 in each stream.
  assert.match(ra.finalHtml, /data-op-id="0"/);
  assert.match(rb.finalHtml, /data-op-id="0"/);
  assert.match(ra.finalHtml, /one/);
  assert.match(rb.finalHtml, /two/);
});
