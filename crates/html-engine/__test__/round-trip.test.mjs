import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { roundTrip } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

test("empty input returns empty", () => {
  assert.equal(roundTrip(""), "");
});

test("fragment round-trips text content", () => {
  const out = roundTrip("<p>Hello <strong>world</strong></p>");
  assert.match(out, /Hello/);
  assert.match(out, /world/);
});

test("counter.html survives FFI", () => {
  const html = starter("counter.html");
  const out = roundTrip(html);
  assert.ok(out.length > 0);
  assert.match(out, /<\/html>|<\/body>/);
});

test("manuscript.html survives FFI", () => {
  const html = starter("manuscript.html");
  const out = roundTrip(html);
  assert.ok(out.length > 0);
});

test("mirror.html survives FFI", () => {
  const html = starter("mirror.html");
  const out = roundTrip(html);
  assert.ok(out.length > 0);
});

test("FFI is deterministic across calls", () => {
  const html = starter("counter.html");
  const a = roundTrip(html);
  const b = roundTrip(html);
  assert.equal(a, b);
});
