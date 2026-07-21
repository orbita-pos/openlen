// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/preview-bake.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bakeModulesForPreviewHtml } from "./preview-bake";
import type { ItemRow } from "@/lib/collections/store";

const HOME = `<!doctype html><html lang="es"><head><title>Mi Negocio</title></head>
<body>
<header><nav><a href="/">Inicio</a></nav></header>
<section><h1>Bienvenido</h1><p>contenido</p></section>
<footer><small>© Mi Negocio</small></footer>
</body></html>`;

const baseCtx = {
  projectId: "p1",
  title: "Mi Negocio",
  sub: null,
  page: null as string | null,
  settings: {} as Record<string, unknown>,
  collectionsItems: null,
};

const item = (over?: Partial<ItemRow>): ItemRow => ({
  id: "i1",
  projectId: "p1",
  collectionId: "c1",
  title: "Producto Uno",
  subtitle: null,
  description: null,
  imageUrl: null,
  priceDisplay: "$100",
  badge: null,
  ctaLabel: null,
  ctaUrl: null,
  tags: [],
  attrs: {},
  status: "published",
  sortOrder: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("bakeModulesForPreviewHtml", () => {
  it("leaves the document untouched when no module is enabled", () => {
    const out = bakeModulesForPreviewHtml(HOME, { ...baseCtx });
    assert.equal(out, HOME);
  });

  it("bakes the WhatsApp FAB when the module is on with a usable number", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { whatsapp: { enabled: true, number: "5215512345678" } },
    });
    assert.ok(out.includes("data-ol-wa-button"), "FAB marker present");
    assert.ok(out.includes("wa.me"), "wa.me link present");
  });

  it("respects the profile contact-widget dedup (same rule as publish)", () => {
    const withWidget = HOME.replace(
      "</body>",
      '<div data-ol-contact-widget><a href="https://wa.me/5215599887766">wa</a></div></body>',
    );
    const out = bakeModulesForPreviewHtml(withWidget, {
      ...baseCtx,
      settings: { whatsapp: { enabled: true, number: "5215512345678" } },
    });
    assert.ok(!out.includes("data-ol-wa-button"), "FAB suppressed like publish");
  });

  it("bakes the chat widget when chat is on", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { chat: { enabled: true } },
    });
    assert.ok(out.includes("data-ol-chat"), "chat markup present");
  });

  it("bakes the comments widget when comments are on", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { comments: { enabled: true } },
    });
    assert.ok(out.includes("data-ol-comments"), "comments markup present");
  });

  it("bakes the bookings widget when bookings are on", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { bookings: { enabled: true } },
    });
    assert.ok(out.includes("data-ol-bookings"), "bookings markup present");
  });

  it("bakes the assistant widget when the assistant is on", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { assistant: { enabled: true } },
    });
    assert.ok(out.includes("data-openlen-assistant"), "assistant markup present");
  });

  it("renders collections items into their placeholder", () => {
    const withPlaceholder = HOME.replace(
      "<footer",
      '<div data-ol-collection-section></div><footer',
    );
    const out = bakeModulesForPreviewHtml(withPlaceholder, {
      ...baseCtx,
      settings: { collections: { enabled: true } },
      collectionsItems: { items: [item()], layout: "grid" },
    });
    assert.ok(out.includes("Producto Uno"), "item rendered");
  });
});
