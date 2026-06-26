// Tests for buildOgCardHtml — the PURE markup the social-card render
// screenshots. (renderOgCard itself needs headless Chrome; it's verified in the
// browser, not here.) Run standalone:
//   npx tsx --test lib/branding/og-card.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { buildOgCardHtml } from "./og-card";

test("renders a 1200x630 card with the title and its initial", () => {
  const html = buildOgCardHtml({ title: "Café Luna" });
  assert.ok(html.includes("1200px") && html.includes("630px"), "fixed frame");
  assert.ok(html.includes(">Café Luna<"), "title present");
  assert.ok(html.includes(">C<"), "initial disc letter");
});

test("escapes the title (no raw injection)", () => {
  const html = buildOgCardHtml({ title: 'A & <b>"X"</b>' });
  assert.ok(html.includes("A &amp; &lt;b&gt;&quot;X&quot;&lt;/b&gt;"), "title escaped");
  assert.ok(!html.includes("<b>"), "no raw tag leaked into markup");
});

test("falls back to a default title (and its initial) when empty", () => {
  const html = buildOgCardHtml({ title: "   " });
  assert.ok(html.includes(">Untitled page<"), "default title");
  assert.ok(html.includes(">U<"), "initial of the default title");
});

test("uses a valid accent hex, ignores junk", () => {
  const ok = buildOgCardHtml({ title: "X", accent: "#1d4ed8" });
  assert.ok(ok.includes("#1d4ed8"), "valid hex flows into the gradient");
  const junk = buildOgCardHtml({ title: "X", accent: "red; } body{display:none}" });
  assert.ok(!junk.includes("display:none"), "junk accent rejected (no CSS injection)");
  assert.ok(junk.includes("#F03E1A"), "falls back to brand coral");
});

test("non-alphanumeric initials keep the first char", () => {
  assert.ok(buildOgCardHtml({ title: "日本語" }).includes(">日<"));
});
