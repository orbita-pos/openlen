// Invariants for the branded dead-link 404 — it ships outside the app
// (static file on the box + /served route), so the contract is: complete,
// self-contained, indexable-off, and free of editor markers.
// Run: npx tsx --test lib/publish/not-found-page.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NOT_FOUND_HTML } from "./not-found-page";

describe("NOT_FOUND_HTML", () => {
  it("is a complete standalone document", () => {
    assert.match(NOT_FOUND_HTML.trimStart().toLowerCase(), /^<!doctype html>/);
    assert.ok(NOT_FOUND_HTML.includes('lang="es"'));
    assert.ok(NOT_FOUND_HTML.includes("</html>"));
    assert.ok(NOT_FOUND_HTML.includes("404"));
  });

  it("opts out of indexing — dead links must not rank", () => {
    assert.ok(NOT_FOUND_HTML.includes('name="robots" content="noindex"'));
  });

  it("carries the growth CTA with attribution", () => {
    assert.ok(
      NOT_FOUND_HTML.includes(
        "https://openlen.com/?utm_source=dead-page&amp;utm_medium=404",
      ),
    );
  });

  it("makes zero external requests (instant even if the box is the only thing alive)", () => {
    assert.doesNotMatch(NOT_FOUND_HTML, /src=["']https?:/i);
    assert.doesNotMatch(NOT_FOUND_HTML, /<link[^>]+href=["']https?:/i);
    assert.ok(!NOT_FOUND_HTML.includes("@import"));
  });

  it("never carries editor markers and stays tiny", () => {
    assert.ok(!NOT_FOUND_HTML.includes("data-slot-path="));
    assert.ok(Buffer.byteLength(NOT_FOUND_HTML, "utf8") < 16_384);
  });
});
