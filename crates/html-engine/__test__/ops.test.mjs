import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  applyOps,
  buildScopedView,
  parseOps,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
} from "../index.js";

test("tagWithOpIds counts and injects ids", () => {
  const r = tagWithOpIds("<div><p>x</p></div>");
  assert.equal(r.taggedCount, 2);
  assert.match(r.taggedHtml, /data-op-id="0"/);
  assert.match(r.taggedHtml, /data-op-id="1"/);
});

test("stripOpIds removes all data-op-id attributes", () => {
  const tagged = tagWithOpIds("<div><p>x</p></div>").taggedHtml;
  const clean = stripOpIds(tagged);
  assert.equal(clean.includes("data-op-id"), false);
});

test("parseOps handles self-closing delete", () => {
  const r = parseOps('<edits><edit op="delete" target="a"/></edits>');
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "delete");
  assert.equal(r.ops[0].target, "a");
});

test("parseOps handles natural-form replace", () => {
  const r = parseOps('<edits><edit op="replace" target="b"><h1>New</h1></edit></edits>');
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "replace");
  assert.equal(r.ops[0].newHtml, "<h1>New</h1>");
});

test("applyOps replace + delete in single batch", () => {
  const tagged = tagWithOpIds("<div><p>a</p><p>b</p></div>").taggedHtml;
  const r = applyOps(tagged, [
    { type: "replace", target: "1", newHtml: "<h1>A</h1>" },
    { type: "delete", target: "2" },
  ]);
  assert.equal(r.errors.length, 0);
  assert.equal(r.appliedCount, 2);
  assert.ok(r.html.includes("<h1>A</h1>"));
  assert.ok(!r.html.includes("<p>b</p>"));
  assert.ok(!r.html.includes("data-op-id"));
});

test("applyOps reports validation errors and bails", () => {
  const tagged = tagWithOpIds("<div>x</div>").taggedHtml;
  const r = applyOps(tagged, [
    { type: "replace", target: "nonexistent", newHtml: "y" },
  ]);
  assert.equal(r.html ?? null, null);
  assert.equal(r.appliedCount, 0);
  assert.equal(r.errors.length, 1);
});

test("applyOps with empty op list returns no html", () => {
  const tagged = tagWithOpIds("<div>x</div>").taggedHtml;
  const r = applyOps(tagged, []);
  // napi-derive maps None → omitted-field (undefined). Call site should
  // normalize via `r.html ?? null` to match the TS contract.
  assert.equal(r.html ?? null, null);
  assert.equal(r.appliedCount, 0);
  assert.equal(r.errors.length, 0);
});

test("resolveOpIdByPath finds element by selector", () => {
  const tagged = tagWithOpIds(
    "<html><body><main><section><h1>x</h1></section></main></body></html>"
  ).taggedHtml;
  const id = resolveOpIdByPath(tagged, "main > section > h1");
  assert.ok(typeof id === "string");
  assert.ok(id.length > 0);
});

test("resolveOpIdByPath returns null on no match", () => {
  const tagged = tagWithOpIds("<html><body><div>x</div></body></html>").taggedHtml;
  const id = resolveOpIdByPath(tagged, "span.missing");
  assert.equal(id, null);
});

test("buildScopedView walks up to semantic container", () => {
  const tagged = tagWithOpIds(
    `<html><body>
      <header><h1>Top</h1></header>
      <main><section><h2>Hero</h2><p>copy</p></section></main>
      <footer><p>©</p></footer>
    </body></html>`
  ).taggedHtml;
  // Pin h1 inside header — walk-up lands ON header (a section-like tag)
  // which IS a body direct child, so the outline marks it SCOPED.
  const m = tagged.match(/<h1 data-op-id="([^"]+)">Top<\/h1>/);
  assert.ok(m, "h1 should be tagged");
  const view = buildScopedView(tagged, m[1]);
  assert.ok(view, "scoped view returned");
  assert.match(view.scopedHtml, /<header/);
  assert.match(view.outline, /<header>/);
  assert.match(view.outline, /<main>/);
  assert.match(view.outline, /<footer>/);
  assert.match(view.outline, /\(SCOPED\)/);
});

test("buildScopedView returns null on missing pin", () => {
  const tagged = tagWithOpIds("<html><body><main></main></body></html>").taggedHtml;
  assert.equal(buildScopedView(tagged, "zzz"), null);
});
