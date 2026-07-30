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
  // Restyle 2026-07-15: tarjetas con sombra + placeholder de inicial
  it("sin imageUrl la tarjeta trae el placeholder con la inicial del título (no caja vacía)", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ title: "cheesecake" })],
      layout: "grid",
    });
    expect(out).toContain(">C</div>");
    expect(out).toContain("linear-gradient");
  });

  it("la inicial del placeholder se escapa (título hostil)", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ title: "<script>alert(1)</script>" })],
      layout: "grid",
    });
    expect(out).not.toContain("<script>alert");
    expect(out).toContain("&lt;"); // la inicial "<" viaja escapada
  });

  it("el grid trae el <style> del hover scoped al marker (sin JS, CSP-clean)", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), { items: [item({})], layout: "grid" });
    expect(out).toContain(".olc-card:hover");
    expect(out).toContain("prefers-reduced-motion");
    expect(out).not.toContain("<script");
  });

  it("el badge va sobre la foto (absolute) en el grid", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [item({ badge: "Popular", imageUrl: "https://img.x/a.jpg" })],
      layout: "grid",
    });
    expect(out).toContain("position:absolute");
    expect(out).toContain("Popular");
  });

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

describe("orders buttons (Pedidos por WhatsApp)", () => {
  const HTML = "<!doctype html><html><head></head><body></body></html>";
  const orderItem = (over: Partial<ItemRow> = {}): ItemRow => ({
    id: "it-1",
    projectId: "p1",
    collectionId: "c1",
    title: "Tacos al pastor",
    subtitle: null,
    description: null,
    imageUrl: null,
    priceDisplay: "$90",
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

  it("orders OFF (absent) emits ZERO order markup — byte-safe for existing projects", () => {
    const out = bakeCollections(HTML, { items: [orderItem()], layout: "grid" });
    expect(out).not.toContain("data-ol-order");
  });

  it("orders null behaves exactly like absent", () => {
    const off = bakeCollections(HTML, { items: [orderItem()], layout: "grid" });
    const nul = bakeCollections(HTML, { items: [orderItem()], layout: "grid", orders: null });
    expect(nul).toBe(off);
  });

  it("orders ON bakes the add button with id/title/price/cents", () => {
    const out = bakeCollections(HTML, {
      items: [orderItem()],
      layout: "grid",
      orders: { number: "5512345678" },
    });
    expect(out).toContain("data-ol-order-add");
    expect(out).toContain('data-ol-order-id="it-1"');
    expect(out).toContain('data-ol-order-title="Tacos al pastor"');
    expect(out).toContain('data-ol-order-cents="9000"');
    expect(out).toContain(">+ Agregar<");
  });

  it("unparseable price bakes an EMPTY cents attr (cart shows 'a confirmar')", () => {
    const out = bakeCollections(HTML, {
      items: [orderItem({ priceDisplay: "Desde $200" })],
      layout: "grid",
      orders: { number: "5512345678" },
    });
    expect(out).toContain('data-ol-order-cents=""');
    expect(out).toContain('data-ol-order-price="Desde $200"');
  });

  it("title with quotes is escaped in the attribute", () => {
    const out = bakeCollections(HTML, {
      items: [orderItem({ title: 'El "especial" <hoy>' })],
      layout: "grid",
      orders: { number: "5512345678" },
    });
    expect(out).toContain("data-ol-order-title=\"El &quot;especial&quot; &lt;hoy&gt;\"");
  });

  it("list layout also carries the button", () => {
    const out = bakeCollections(HTML, {
      items: [orderItem()],
      layout: "list",
      orders: { number: "5512345678" },
    });
    expect(out).toContain("data-ol-order-add");
  });

  it("english page (<html lang=\"en\">) gets an Add label", () => {
    const out = bakeCollections(
      '<!doctype html><html lang="en"><head></head><body></body></html>',
      { items: [orderItem()], layout: "grid", orders: { number: "5512345678" } },
    );
    expect(out).toContain(">+ Add<");
  });
});

// Tema de la cuadrícula (2026-07-30). Colecciones era el ÚNICO módulo con banda
// sin noción de tema: sobre una página oscura las tarjetas salían blancas. El
// acento siempre se detectó — lo que faltaba eran las SUPERFICIES.
describe("collections theme", () => {
  const RICH = () =>
    item({ title: "Playera", subtitle: "Negro", description: "Algodón", badge: "Nueva" });

  it("sin theme la salida es BYTE-IDÉNTICA a pedir light (nada churnea al republicar)", () => {
    const base = bakeCollections(PAGE(PLACEHOLDER), { items: [RICH()], layout: "grid" });
    const light = bakeCollections(PAGE(PLACEHOLDER), {
      items: [RICH()],
      layout: "grid",
      theme: "light",
    });
    expect(light).toBe(base);
  });

  it("light conserva las superficies claras históricas", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), { items: [RICH()], layout: "grid" });
    expect(out).toContain("background:#fff;display:flex");
    expect(out).toContain("color:#16181d;");
    expect(out).toContain("rgba(23,18,14,.06)");
  });

  it("dark oscurece tarjeta, tinta y sombra — y NO deja la tarjeta blanca", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [RICH()],
      layout: "grid",
      theme: "dark",
    });
    expect(out).toContain("background:#1c1f24;display:flex"); // tarjeta
    expect(out).toContain("color:#e8e8ea;"); // título
    expect(out).toContain("color:#9aa0a8;"); // subtítulo
    expect(out).toContain("color:#b3b9c1;"); // descripción
    expect(out).toContain("0 0 0 1px #33363c"); // anillo en vez de sombra difusa
    expect(out).not.toContain("background:#fff;display:flex");
  });

  it("dark también viste el hover del <style> (si no, la tarjeta parpadea a claro)", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [RICH()],
      layout: "grid",
      theme: "dark",
    });
    expect(out).toContain(".olc-card:hover{transform:translateY(-3px);box-shadow:0 0 0 1px #3d4148");
    expect(out).not.toContain("rgba(23,18,14,.12)");
  });

  it("dark en list: el separador de filas se invierte a blanco translúcido", () => {
    const out = bakeCollections(PAGE(PLACEHOLDER), {
      items: [RICH(), RICH()],
      layout: "list",
      theme: "dark",
    });
    expect(out).toContain("border-bottom:1px solid rgba(255,255,255,.09)");
    expect(out).not.toContain("border-bottom:1px solid rgba(0,0,0,.06)");
  });

  it("el acento de la página manda en AMBOS temas (el tema solo toca superficies)", () => {
    const page = (inner: string) =>
      `<html><head><style>:root{--ol-accent:#e8192c}</style></head><body>${inner}</body></html>`;
    for (const theme of ["light", "dark"] as const) {
      const out = bakeCollections(page(PLACEHOLDER), {
        items: [RICH()],
        layout: "grid",
        theme,
      });
      expect(out).toContain("#e8192c");
    }
  });
});
