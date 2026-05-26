import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { normalizeBornCanonical } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");
const fixture = (name) =>
  readFileSync(resolve(here, "../tests/fixtures/chain", name), "utf8");

test("empty input returns empty", () => {
  assert.equal(normalizeBornCanonical(""), "");
});

test("mirror.html byte-equal vs TS chain", () => {
  assert.equal(normalizeBornCanonical(starter("mirror.html")), fixture("mirror.html"));
});

test("counter.html byte-equal vs TS chain", () => {
  assert.equal(normalizeBornCanonical(starter("counter.html")), fixture("counter.html"));
});

test("manuscript.html byte-equal vs TS chain", () => {
  assert.equal(
    normalizeBornCanonical(starter("manuscript.html")),
    fixture("manuscript.html"),
  );
});

test("idempotent on mirror.html", () => {
  const once = normalizeBornCanonical(starter("mirror.html"));
  const twice = normalizeBornCanonical(once);
  assert.equal(once, twice);
});
