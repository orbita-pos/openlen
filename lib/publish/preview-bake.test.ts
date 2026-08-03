// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/preview-bake.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bakeModulesForPreviewHtml } from "./preview-bake";
import { buildModuleSection } from "./module-sections";
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

describe("preview mirrors publish's FAB stacking", () => {
  it("lifts an unmergeable chat one slot above the assistant", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: {
        assistant: { enabled: true },
        chat: { enabled: true, mount: "fab", identityMode: "account" },
        whatsapp: { enabled: true, number: "5512345678" },
      },
    });
    assert.ok(out.includes('"bottom":86'), "chat above the assistant");
    assert.ok(out.includes("bottom:154px"), "WhatsApp above both, no empty slot");
  });

  it("keeps ONE bubble when the chat merges into the assistant (handoff)", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: {
        assistant: { enabled: true },
        chat: { enabled: true, mount: "fab" },
        whatsapp: { enabled: true, number: "5512345678" },
      },
    });
    assert.ok(out.includes('"handoff":true'));
    assert.ok(!out.includes('"bottom":86'));
    assert.ok(out.includes("bottom:86px"), "WhatsApp above the single bubble");
  });
});

describe("preview scopes section modules to their band", () => {
  const bands = { bookings: true, comments: true };

  it("skips the widget on a document without the band when the site has one", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { bookings: { enabled: true }, comments: { enabled: true } },
      sectionBands: bands,
    });
    assert.ok(!out.includes("data-ol-bookings-widget"));
    assert.ok(!out.includes("data-ol-comments-widget"));
  });

  it("renders it on the document that carries the band", () => {
    const withBand = HOME.replace(
      "<footer",
      '<section data-ol-bookings-section></section><footer',
    );
    const out = bakeModulesForPreviewHtml(withBand, {
      ...baseCtx,
      settings: { bookings: { enabled: true } },
      sectionBands: bands,
    });
    assert.ok(out.includes("data-ol-bookings-widget"));
  });

  it("no band anywhere keeps the append-everywhere fallback", () => {
    const out = bakeModulesForPreviewHtml(HOME, {
      ...baseCtx,
      settings: { bookings: { enabled: true } },
      sectionBands: { bookings: false, comments: false },
    });
    assert.ok(out.includes("data-ol-bookings-widget"));
  });
});

describe("preview plays video links the same way publish does", () => {
  const withVideo = HOME.replace(
    "<footer",
    '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Ver el video</a><footer',
  );

  it("tags a YouTube link and injects the lightbox runtime", () => {
    const out = bakeModulesForPreviewHtml(withVideo, { ...baseCtx });
    assert.ok(out.includes('data-ol-video="yt:dQw4w9WgXcQ"'), "anchor tagged");
    assert.ok(out.includes("data-ol-video-lightbox"), "runtime injected");
    assert.ok(
      out.includes("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "href kept — JS off still links out",
    );
  });

  it("leaves a document with no video links untouched", () => {
    assert.equal(bakeModulesForPreviewHtml(HOME, { ...baseCtx }), HOME);
  });

  it("honours the OPENLEN_VIDEO_EMBED kill switch", () => {
    const prev = process.env.OPENLEN_VIDEO_EMBED;
    process.env.OPENLEN_VIDEO_EMBED = "0";
    try {
      assert.equal(bakeModulesForPreviewHtml(withVideo, { ...baseCtx }), withVideo);
    } finally {
      if (prev === undefined) delete process.env.OPENLEN_VIDEO_EMBED;
      else process.env.OPENLEN_VIDEO_EMBED = prev;
    }
  });

  it("is idempotent — a second pass adds no second runtime", () => {
    const once = bakeModulesForPreviewHtml(withVideo, { ...baseCtx });
    const twice = bakeModulesForPreviewHtml(once, { ...baseCtx });
    assert.equal(twice, once);
  });

  // Medido en navegador: bajo `sandbox allow-scripts` (sin allow-same-origin)
  // el player de YouTube lanza jserror y deja un rectángulo negro. Ahí el
  // enlace crudo — que navega a YouTube — es la mejor experiencia posible.
  it("skips the lightbox on a sandboxed surface (opaque origin)", () => {
    const out = bakeModulesForPreviewHtml(withVideo, { ...baseCtx, sandboxed: true });
    assert.equal(out, withVideo);
  });

  it("still bakes the other modules on a sandboxed surface", () => {
    const out = bakeModulesForPreviewHtml(withVideo, {
      ...baseCtx,
      sandboxed: true,
      settings: { whatsapp: { enabled: true, number: "5215512345678" } },
    });
    assert.ok(out.includes("data-ol-wa-button"), "FAB still baked");
    assert.ok(!out.includes("data-ol-video-lightbox"), "video still skipped");
  });
});

// El borrador tiene que enseñar lo que se va a publicar. Antes el relleno de la
// banda se gateaba con `ctx.platforms?.length`, así que sin enlaces no corría y
// /p/ mostraba un "Encuéntrame en" sobre un hueco que la página publicada no
// iba a tener. Sembrar (data.html) sí preserva la banda — ahí borrarla comía
// trabajo del creador; esta superficie es la del visitante.
describe("bakeModulesForPreviewHtml + banda Mis plataformas", () => {
  const BAND = buildModuleSection("platforms", { lang: "es" });
  const DOC = HOME.replace("<footer", `${BAND}<footer`);

  it("rellena la banda con los enlaces del perfil", () => {
    const out = bakeModulesForPreviewHtml(DOC, {
      ...baseCtx,
      platforms: [{ type: "twitch", url: "kira" }],
    });
    assert.match(out, /href="https:\/\/twitch\.tv\/kira"/);
    assert.ok(out.includes("Encuéntrame en"), "el encabezado sigue ahí");
  });

  it("sin enlaces BORRA la banda, igual que publicar", () => {
    for (const platforms of [[], null, undefined]) {
      const out = bakeModulesForPreviewHtml(DOC, { ...baseCtx, platforms });
      assert.ok(!out.includes("data-ol-platforms-section"), "marcador fuera");
      assert.ok(!out.includes("Encuéntrame en"), "encabezado fuera con su banda");
      assert.ok(out.includes("<h1>Bienvenido</h1>"), "el resto de la página intacto");
    }
  });

  it("un enlace capturado pero no armable cuenta como sin enlaces", () => {
    const out = bakeModulesForPreviewHtml(DOC, {
      ...baseCtx,
      platforms: [{ type: "website", url: "micafe" }],
    });
    assert.ok(!out.includes("data-ol-platforms-section"));
  });

  it("una página sin la banda no cambia", () => {
    assert.equal(
      bakeModulesForPreviewHtml(HOME, { ...baseCtx, platforms: [] }),
      HOME,
    );
  });
});
