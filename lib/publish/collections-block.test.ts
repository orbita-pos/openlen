// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bakeCollections } from "./collections-block";
import type { ItemRow } from "@/lib/collections/store";

function item(p: Partial<ItemRow>): ItemRow {
  return {
    id: "1",
    projectId: "p",
    collectionId: "c",
    title: "Item",
    subtitle: null,
    description: null,
    imageUrl: null,
    priceDisplay: null,
    badge: null,
    ctaLabel: null,
    ctaUrl: null,
    tags: [],
    attrs: {},
    status: "published",
    sortOrder: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

const PLACEHOLDER = `<section data-ol-collection-section style="border:1px dashed #ccc">drop here</section>`;
const PAGE = (inner: string) => `<html><body>${inner}</body></html>`;

describe("bakeCollections", () => {
  it("replaces the placeholder with a static grid (no dashed box ships)", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), { items: [item({ title: "Espresso" })], layout: "grid" });
    expect(out).toContain("data-ol-collection-widget");
    expect(out).toContain("Espresso");
    expect(out).not.toContain("data-ol-collection-section");
    expect(out).not.toContain("drop here");
  });

  it("HTML-escapes item fields (no XSS in static mode)", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ title: "<img src=x onerror=alert(1)>", description: "</script><b>boom" })],
      layout: "grid",
    });
    expect(out).not.toContain("<img src=x onerror");
    expect(out).toContain("&lt;img src=x onerror");
    expect(out).not.toContain("</script><b>boom");
  });

  it("drops an unsafe cta url, keeps a safe one", () => {
    const bad = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ ctaLabel: "Buy", ctaUrl: "javascript:alert(1)" })],
      layout: "grid",
    });
    expect(bad).not.toContain("javascript:");
    const good = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ ctaLabel: "Buy", ctaUrl: "https://wa.me/52" })],
      layout: "grid",
    });
    expect(good).toContain("https://wa.me/52");
  });

  it("drops a protocol-relative / unsafe image src", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ imageUrl: "//evil.com/x.jpg" })],
      layout: "grid",
    });
    expect(out).not.toContain("//evil.com");
  });

  it("strips the dashed placeholder when there are no items", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), { items: [], layout: "grid" });
    expect(out).not.toContain("data-ol-collection-section");
    expect(out).not.toContain("drop here");
  });

  it("auto-appends on the home doc (allowAppend) when there's no placeholder", () => {
    const out = bakeCollections(PAGE("<h1>Home</h1>"), { items: [item({ title: "A" })], layout: "grid" }, true);
    expect(out).toContain("data-ol-collection-widget");
    expect(out).toContain("A");
  });

  it("does NOT append on a subpage (allowAppend=false) without a placeholder", () => {
    const out = bakeCollections(PAGE("<h1>About</h1>"), { items: [item({ title: "A" })], layout: "grid" }, false);
    expect(out).not.toContain("data-ol-collection-widget");
  });

  it("is idempotent — already-baked html is returned untouched", () => {
    const once = bakeCollections(PAGE(PLACEHOLDER), { items: [item({ title: "A" })], layout: "grid" });
    const twice = bakeCollections(once, { items: [item({ title: "B" })], layout: "grid" });
    expect(twice).toBe(once);
  });

  it("renders a list layout", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ title: "Tacos", priceDisplay: "$30" })],
      layout: "list",
    });
    expect(out).toContain("Tacos");
    expect(out).toContain("$30");
  });
});
