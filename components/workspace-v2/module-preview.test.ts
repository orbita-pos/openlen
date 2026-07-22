// Editor-canvas module preview (scriptless subset) — the injected markup must
// (a) render the module UI, (b) never survive a save: every injected node
// carries the preview marker and stripEditorInstrumentation removes it.
import { describe, expect, it } from "vitest";
import {
  bandWithPreview,
  injectEditorModulesPreview,
  type EditorModulesPreviewCfg,
} from "./module-preview";
import { buildModuleSection } from "@/lib/publish/module-sections";
import { stripEditorInstrumentation } from "./strip-editor-instrumentation";
import type { ItemRow } from "@/lib/collections/store";

const HOME = `<!doctype html><html lang="es"><head><title>Mi Negocio</title></head>
<body>
<header><nav><a href="/">Inicio</a></nav></header>
<section><h1>Bienvenido</h1><p>contenido</p></section>
<section data-ol-collection-section style="padding:32px"><div></div></section>
<footer><small>© Mi Negocio</small></footer>
</body></html>`;

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

const cfg = (over?: Partial<EditorModulesPreviewCfg>): EditorModulesPreviewCfg => ({
  whatsapp: undefined,
  assistantOn: false,
  chatFabOn: false,
  musicOn: false,
  collections: null,
  ...over,
});

describe("injectEditorModulesPreview", () => {
  it("is a no-op with no modules configured", () => {
    expect(injectEditorModulesPreview(HOME, cfg())).toBe(HOME);
  });

  it("injects the WhatsApp FAB, stamped preview + no-edit", () => {
    const out = injectEditorModulesPreview(HOME, cfg({
      whatsapp: { enabled: true, number: "5215512345678" },
    }));
    expect(out).toContain("data-ol-wa-button");
    expect(out).toContain("wa.me");
    const fabTag = /<a[^>]*data-ol-wa-button[^>]*>/.exec(out)?.[0] ?? "";
    expect(fabTag).toContain("data-openlen-modules-preview");
    expect(fabTag).toContain("data-openlen-no-edit");
  });

  it("respects the contact-widget dedup", () => {
    const withWidget = HOME.replace(
      "</body>",
      '<div data-ol-contact-widget><a href="https://wa.me/5215599887766">wa</a></div></body>',
    );
    const out = injectEditorModulesPreview(withWidget, cfg({
      whatsapp: { enabled: true, number: "5215512345678" },
    }));
    expect(out).not.toContain("data-ol-wa-button");
  });

  it("renders the catalog INSIDE the band without touching the band markup", () => {
    const out = injectEditorModulesPreview(HOME, cfg({
      collections: { items: [item()], layout: "grid", ordersNumber: null },
    }));
    expect(out).toContain("Producto Uno");
    // Band open tag preserved verbatim.
    expect(out).toContain('<section data-ol-collection-section style="padding:32px">');
    // Grid sits inside the band (after its open tag, before its close). Anchor
    // the search past <body> — the injected head <style> mentions the marker.
    const bodyAt = out.indexOf("<body");
    const band = out.indexOf("data-ol-collection-section", bodyAt);
    const grid = out.indexOf("data-ol-collection-widget", bodyAt);
    const bandClose = out.indexOf("</section>", band);
    expect(grid).toBeGreaterThan(band);
    expect(grid).toBeLessThan(bandClose);
    // Every injected root is stamped.
    const gridTag = /<div[^>]*data-ol-collection-widget[^>]*>/.exec(out)?.[0] ?? "";
    expect(gridTag).toContain("data-openlen-modules-preview");
  });

  it("collections without items only ghosts when the band exists (no band → untouched)", () => {
    const noBand = HOME.replace('<section data-ol-collection-section style="padding:32px"><div></div></section>\n', "");
    const out = injectEditorModulesPreview(noBand, cfg({
      collections: { items: [], layout: "grid", ordersNumber: null },
    }));
    expect(out).toBe(noBand);
  });

  it("stacks the FAB above an assistant bubble", () => {
    const out = injectEditorModulesPreview(HOME, cfg({
      whatsapp: { enabled: true, number: "5215512345678" },
      assistantOn: true,
    }));
    expect(out).toContain("bottom:86px");
  });

  it("bookings band gets a static skeleton when the module is on", () => {
    const withBand = HOME.replace(
      "<footer",
      '<section><div data-ol-bookings-section></div></section><footer',
    );
    const out = injectEditorModulesPreview(withBand, cfg({ bookingsOn: true }));
    const tag = /<div[^>]*data-ol-bookings-skeleton[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain("data-openlen-modules-preview");
    expect(out).toContain("Vista previa");
  });

  it("no bookings skeleton without the band, or with the module off", () => {
    expect(injectEditorModulesPreview(HOME, cfg({ bookingsOn: true }))).toBe(HOME);
    const withBand = HOME.replace(
      "<footer",
      '<section><div data-ol-bookings-section></div></section><footer',
    );
    expect(injectEditorModulesPreview(withBand, cfg())).toBe(withBand);
  });

  it("comments band gets sample-comment skeleton when on", () => {
    const withBand = HOME.replace(
      "<footer",
      '<section><div data-ol-comments-section></div></section><footer',
    );
    const out = injectEditorModulesPreview(withBand, cfg({ commentsOn: true }));
    const tag = /<div[^>]*data-ol-comments-skeleton[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain("data-openlen-modules-preview");
  });

  it("collections band with ZERO items gets ghost product cards", () => {
    const withPlaceholder = HOME.replace(
      "<footer",
      '<div data-ol-collection-section></div><footer',
    );
    const out = injectEditorModulesPreview(withPlaceholder, cfg({
      collections: { items: [], layout: "grid", ordersNumber: null },
    }));
    const tag = /<div[^>]*data-ol-collection-ghosts[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain("data-openlen-modules-preview");
  });

  it("skeletons strip clean on save", () => {
    const withBands = HOME.replace(
      "<footer",
      '<section><div data-ol-bookings-section></div></section><section><div data-ol-comments-section></div></section><footer',
    );
    const injected = injectEditorModulesPreview(withBands, cfg({
      bookingsOn: true,
      commentsOn: true,
      collections: { items: [], layout: "grid", ordersNumber: null },
    }));
    const norm = (h: string) =>
      new DOMParser().parseFromString(h, "text/html").documentElement.outerHTML;
    expect(norm(stripEditorInstrumentation(injected))).toBe(norm(withBands));
  });

  it("bandWithPreview: the insert payload carries the marked skeleton inside the band", () => {
    const band = buildModuleSection("bookings", { lang: "es" });
    const out = bandWithPreview("bookings", band, { docHtml: HOME });
    expect(out).toContain("data-ol-bookings-skeleton");
    const skel = /<div[^>]*data-ol-bookings-skeleton[^>]*>/.exec(out)?.[0] ?? "";
    expect(skel).toContain("data-openlen-modules-preview");
    // Skeleton sits INSIDE the band's marker element.
    expect(out.indexOf("data-ol-bookings-skeleton")).toBeGreaterThan(
      out.indexOf("data-ol-bookings-section"),
    );
    // Stripping the payload (as the save serialization does) restores the bare band.
    const doc = HOME.replace("</body>", out + "</body>");
    const norm = (h: string) =>
      new DOMParser().parseFromString(h, "text/html").documentElement.outerHTML;
    expect(norm(stripEditorInstrumentation(doc))).toBe(
      norm(HOME.replace("</body>", band + "</body>")),
    );
  });

  it("round-trips clean: strip(inject(x)) equals x", () => {
    const injected = injectEditorModulesPreview(HOME, cfg({
      whatsapp: { enabled: true, number: "5215512345678" },
      collections: { items: [item()], layout: "grid", ordersNumber: "5215587654321" },
    }));
    // Normalize both sides through the same parser — strip's fast-path returns
    // marker-less docs verbatim, so raw string equality would compare two
    // different serializers.
    const norm = (h: string) =>
      new DOMParser().parseFromString(h, "text/html").documentElement.outerHTML;
    expect(norm(stripEditorInstrumentation(injected))).toBe(norm(HOME));
  });
});
