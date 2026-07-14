import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { sanitizeForPublish } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

test("empty input passes through", () => {
  const r = sanitizeForPublish("");
  assert.equal(r.html, "");
  assert.deepEqual(r.errors, []);
});

test("clean HTML is byte-equal", () => {
  const html = '<div class="card"><h2>Hi</h2><p>x</p></div>';
  const r = sanitizeForPublish(html);
  assert.equal(r.html, html);
  assert.deepEqual(r.errors, []);
  assert.equal(r.removed.scripts, 0);
  assert.equal(r.removed.eventHandlers, 0);
  assert.equal(r.removed.dangerousUrls, 0);
  assert.equal(r.removed.iframes, 0);
  assert.equal(r.removed.metaRefresh, 0);
});

test("data-slot-path literal is rejected (html absent)", () => {
  const r = sanitizeForPublish('<div data-slot-path="hero.title">x</div>');
  // napi-rs serializes None as absent property (per session 1 handoff note —
  // callers should treat absence the same as null).
  assert.ok(r.html == null, `expected html absent, got ${r.html}`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /data-slot-path/);
  assert.match(r.errors[0], /literal/);
});

test("data-slot-path entity-encoded is rejected", () => {
  const r = sanitizeForPublish('<div &#100;ata-slot-path="x">y</div>');
  assert.ok(r.html == null);
  assert.match(r.errors[0], /entity-encoded/);
});

test("data-slot-path mixed-case is rejected", () => {
  const r = sanitizeForPublish('<div Data-Slot-Path="x">y</div>');
  assert.ok(r.html == null);
  assert.match(r.errors[0], /mixed-case/);
});

test("data-slot-path with whitespace around = is rejected", () => {
  const r = sanitizeForPublish('<div data-slot-path =\t"x">y</div>');
  assert.ok(r.html == null);
  assert.match(r.errors[0], /whitespace-around-equals/);
});

test("inline script stripped + tailwind kept", () => {
  const html =
    '<p>x</p><script>alert(1)</script><script src="https://cdn.tailwindcss.com"></script>';
  const r = sanitizeForPublish(html);
  assert.ok(r.html != null);
  assert.ok(!r.html.includes("alert"));
  assert.ok(r.html.includes("cdn.tailwindcss.com"));
  assert.equal(r.removed.scripts, 1);
});

test("event handlers + dangerous urls + iframes all stripped", () => {
  const html =
    '<div onclick="x()"><iframe src="//evil"></iframe>' +
    '<a href="javascript:y()" ping="javascript:z()">link</a></div>';
  const r = sanitizeForPublish(html);
  assert.ok(r.html != null);
  assert.ok(!r.html.includes("onclick"));
  assert.ok(!r.html.includes("<iframe"));
  assert.ok(!r.html.includes("javascript"));
  assert.equal(r.removed.eventHandlers, 1);
  assert.equal(r.removed.iframes, 1);
  assert.equal(r.removed.dangerousUrls, 2);
});

test("meta refresh removed", () => {
  const r = sanitizeForPublish('<meta http-equiv="refresh" content="0;url=//evil">');
  assert.ok(r.html != null);
  assert.ok(!r.html.includes("http-equiv"));
  assert.equal(r.removed.metaRefresh, 1);
});

test("idempotent on dirty input", () => {
  const dirty =
    '<div><script>a()</script><iframe></iframe><a href="javascript:b()" onclick="c()">x</a></div>';
  const r1 = sanitizeForPublish(dirty);
  const r2 = sanitizeForPublish(r1.html);
  assert.equal(r1.html, r2.html);
  assert.equal(r2.removed.scripts, 0);
  assert.equal(r2.removed.eventHandlers, 0);
  assert.equal(r2.removed.dangerousUrls, 0);
  assert.equal(r2.removed.iframes, 0);
});

test("counter.html starter is byte-equal (sanitize-clean)", () => {
  const src = starter("counter.html");
  const r = sanitizeForPublish(src);
  assert.equal(r.html, src);
  assert.equal(r.removed.scripts, 0);
});

test("manuscript.html starter is byte-equal (sanitize-clean)", () => {
  const src = starter("manuscript.html");
  const r = sanitizeForPublish(src);
  assert.equal(r.html, src);
  assert.equal(r.removed.scripts, 0);
});

test("mirror.html starter is byte-equal (sanitize-clean)", () => {
  const src = starter("mirror.html");
  const r = sanitizeForPublish(src);
  assert.equal(r.html, src);
  assert.equal(r.removed.scripts, 0);
});
