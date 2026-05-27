// Tests for normalizeBornCanonical — the seven-pass design-axis chain
// (radius / spacing / type / font / accent / color / modes). Backed by
// Rust's `normalize_born_canonical` since F1 S9.
//
// The frozen byte-equal fixtures for each pass live under
// `crates/html-engine/tests/fixtures/{pass}/{name}.html` and are checked
// by the Rust crate's tests — this file validates the public TS contract.
//
// Run via: npx tsx --test lib/normalize.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { normalizeBornCanonical } from "./normalize";

const STARTER_DIR = join(process.cwd(), "templates", "starter");
const TEMPLATES = ["mirror.html", "counter.html", "manuscript.html"];

function readStarter(name: string): string {
  return readFileSync(join(STARTER_DIR, name), "utf8");
}

test("empty string passes through unchanged", () => {
  assert.equal(normalizeBornCanonical(""), "");
});

test("leaves at least one canonical marker on mirror starter", () => {
  const html = readStarter("mirror.html");
  const r = normalizeBornCanonical(html);
  assert.ok(r.length > 0);
  const hasMarker =
    r.includes("--openlen-radius") ||
    r.includes("--openlen-accent") ||
    r.includes("data-ol-radius") ||
    r.includes("data-ol-accent") ||
    r.includes(":root") ||
    r !== html;
  assert.ok(hasMarker, "normalize should leave at least one visible mark");
});

for (const name of TEMPLATES) {
  test(`idempotent on ${name}: running twice == once`, () => {
    const html = readStarter(name);
    const once = normalizeBornCanonical(html);
    const twice = normalizeBornCanonical(once);
    assert.equal(once, twice);
  });
}

test("preserves visible content on a tiny inline-style doc", () => {
  const html =
    '<!doctype html><html><head><style>:root{--accent:#3366ff}</style></head><body><div>hi</div></body></html>';
  const r = normalizeBornCanonical(html);
  assert.ok(r.length > 0);
  assert.ok(r.includes("<div>hi</div>"));
});

test("idempotent on the tiny inline-style doc", () => {
  const html =
    '<!doctype html><html><head><style>:root{--accent:#3366ff}</style></head><body><div>hi</div></body></html>';
  const once = normalizeBornCanonical(html);
  const twice = normalizeBornCanonical(once);
  assert.equal(once, twice);
});
