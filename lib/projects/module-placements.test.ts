// lib/projects/module-placements.test.ts
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/projects/module-placements.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modulePlacements, pageHasModule } from "./module-placements";

const HOME = `<html><body><div data-ol-collection-section></div></body></html>`;
const PAGE_BK = `<html><body><div data-ol-bookings-section></div></body></html>`;
const PAGE_BOTH = `<html><body><div data-ol-collection-section></div><div data-ol-comments-section></div></body></html>`;
const PAGE_PLAT = `<html><body><section><div data-ol-platforms-section></div></section></body></html>`;

describe("modulePlacements", () => {
  it("maps each module to the docs carrying its band — home first, slugs sorted", () => {
    const out = modulePlacements({
      html: HOME,
      pages: { zeta: { html: PAGE_BOTH }, alfa: { html: PAGE_BK } },
    });
    assert.deepEqual(out.collections, ["", "zeta"]);
    assert.deepEqual(out.bookings, ["alfa"]);
    assert.deepEqual(out.comments, ["zeta"]);
  });
  it("empty everywhere → empty lists; null-safe", () => {
    assert.deepEqual(modulePlacements({ html: "<html></html>" }), {
      collections: [], bookings: [], comments: [], platforms: [],
    });
    assert.deepEqual(modulePlacements(null), {
      collections: [], bookings: [], comments: [], platforms: [],
    });
  });
  it("pageHasModule checks one document", () => {
    assert.equal(pageHasModule(HOME, "collections"), true);
    assert.equal(pageHasModule(HOME, "bookings"), false);
    assert.equal(pageHasModule(null, "comments"), false);
  });
  it("platforms: the band's marker is tracked like every other module", () => {
    const out = modulePlacements({ html: PAGE_PLAT, pages: { beta: { html: HOME } } });
    assert.deepEqual(out.platforms, [""]);
    assert.equal(pageHasModule(PAGE_PLAT, "platforms"), true);
    assert.equal(pageHasModule(HOME, "platforms"), false);
  });
});
