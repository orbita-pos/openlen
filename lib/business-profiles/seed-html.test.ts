import { describe, it, expect } from "vitest";
import { seedBrandIntoHtml, fillPlatformsBand, profileMeta } from "./seed-html";
import { platformLinkRenders } from "./platforms-band";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import { buildModuleSection } from "@/lib/publish/module-sections";
import { modulePlacements } from "@/lib/projects/module-placements";
import type { BusinessProfileData } from "./types";

const HTML =
  "<html><head><title>x</title></head><body><h1>Hi</h1></body></html>";

const BANDA = '<html lang="es"><body><section data-ol-platforms-section></section></body></html>';

function profile(over: Partial<BusinessProfileData> = {}): BusinessProfileData {
  return { ...coerceBusinessData({}), ...over };
}

describe("seedBrandIntoHtml", () => {
  it("is a no-op for an empty profile (Business seeds, never gates)", () => {
    expect(seedBrandIntoHtml(HTML, profile())).toBe(HTML);
  });

  it("applies the brand accent when set", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({ brand: { accent: "#1166EE", logoUrl: null } }),
    );
    expect(out).toContain("data-ol-accent-applied");
    expect(out).toContain("#1166ee");
  });

  it("appends a contact widget when there is real contact", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        contact: {
          whatsapp: "5512345678",
          phone: null,
          email: null,
          address: null,
          socials: null,
        },
      }),
    );
    expect(out).toContain("data-ol-contact-widget");
    expect(out).toContain("wa.me/");
  });

  it("recolor:false keeps the design's accent but still adds the contact widget", () => {
    const data = profile({
      brand: { accent: "#1166EE", logoUrl: null },
      contact: {
        whatsapp: "5512345678",
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    const out = seedBrandIntoHtml(HTML, data, { recolor: false });
    expect(out).not.toContain("data-ol-accent-applied");
    expect(out).toContain("data-ol-contact-widget");
  });

  it("adds NO contact widget when the contact block is all empty", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        contact: {
          whatsapp: null,
          phone: null,
          email: null,
          address: null,
          socials: null,
        },
      }),
    );
    expect(out).not.toContain("data-ol-contact-widget");
  });

  it("showContactWidget:false hides the bar even with real contact", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        showContactWidget: false,
        contact: {
          whatsapp: "5512345678",
          phone: null,
          email: null,
          address: null,
          socials: null,
        },
      }),
    );
    expect(out).not.toContain("data-ol-contact-widget");
  });

  it("re-seeding with showContactWidget:false strips a previously-baked bar", () => {
    const contact = {
      whatsapp: "5512345678",
      phone: null,
      email: null,
      address: null,
      socials: null,
    };
    const withBar = seedBrandIntoHtml(HTML, profile({ contact }));
    expect(withBar).toContain("data-ol-contact-widget");
    const off = seedBrandIntoHtml(
      withBar,
      profile({ contact, showContactWidget: false }),
    );
    expect(off).not.toContain("data-ol-contact-widget");
  });

  it("single contact renders a direct FAB (no collapse, no checkbox)", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        contact: { whatsapp: "5512345678", phone: null, email: null, address: null, socials: null },
      }),
    );
    expect(out).toContain("data-ol-contact-widget");
    expect(out).toContain("wa.me/");
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain("ol-cw-fab");
  });

  it("defaults the bar to the right; contactWidgetSide:left moves it left", () => {
    const c = { whatsapp: "5512345678", phone: null, email: null, address: null, socials: null };
    const right = seedBrandIntoHtml(HTML, profile({ contact: c }));
    expect(right).toContain("right:16px");
    const left = seedBrandIntoHtml(HTML, profile({ contactWidgetSide: "left", contact: c }));
    expect(left).toContain("left:16px");
    expect(left).not.toContain("right:16px");
  });

  it("multiple contacts collapse into a pure-CSS speed-dial (no JS)", () => {
    const out = seedBrandIntoHtml(
      HTML,
      profile({
        contact: {
          whatsapp: "5512345678",
          phone: "5598765432",
          email: null,
          address: null,
          socials: { instagram: "openlen", facebook: null, tiktok: null, website: null },
        },
      }),
    );
    expect(out).toContain("data-ol-contact-widget");
    expect(out).toContain("ol-cw-fab");
    expect(out).toContain("ol-cw-items");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("wa.me/");
    expect(out).toContain("instagram.com/openlen");
    // The collapse must be pure CSS — a <script> would be stripped/blocked by
    // the publish seal, leaving the bar stuck closed.
    expect(out).not.toContain("<script");
  });

  it("multi-contact speed-dial is idempotent on re-seed (nested markup strips clean)", () => {
    const data = profile({
      contact: {
        whatsapp: "5512345678",
        phone: "5598765432",
        email: null,
        address: null,
        socials: { instagram: "openlen", facebook: null, tiktok: null, website: null },
      },
    });
    const once = seedBrandIntoHtml(HTML, data);
    const twice = seedBrandIntoHtml(once, data);
    expect(twice).toBe(once);
    // Count structural tokens, not the class names (which recur in the <style>).
    expect(twice.match(/<div data-ol-contact-widget/g)?.length).toBe(1);
    expect(twice.match(/id="ol-cw-t"/g)?.length).toBe(1);
  });

  it("is idempotent — re-seeding never duplicates the widget or accent", () => {
    const data = profile({
      brand: { accent: "#1166EE", logoUrl: null },
      contact: {
        whatsapp: "5512345678",
        phone: null,
        email: null,
        address: null,
        socials: null,
      },
    });
    const once = seedBrandIntoHtml(HTML, data);
    const twice = seedBrandIntoHtml(once, data);
    expect(twice).toBe(once);
    expect(twice.match(/data-ol-contact-widget/g)?.length).toBe(1);
    expect(twice.match(/data-ol-accent-applied/g)?.length).toBe(1);
  });

  it("rellena la banda de plataformas cuando la página la tiene", () => {
    const out = seedBrandIntoHtml(BANDA, { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData);
    expect(out).toContain('href="https://twitch.tv/kira"');
  });

  it("re-sembrar no duplica la banda", () => {
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    const once = seedBrandIntoHtml(BANDA, data);
    expect(seedBrandIntoHtml(once, data)).toBe(once);
  });

  // Este test afirmaba lo contrario y por eso el defecto pasó cinco revisiones:
  // sembrar corre en CADA guardado de Mi negocio, así que borrar ahí le comía
  // al creador una sección que insertó a propósito, en silencio. El encabezado
  // huérfano se evita donde importa —publicar y /p/—, no sobre data.html.
  it("sin plataformas PRESERVA la banda (borrarla es cosa de publicar, no de sembrar)", () => {
    const out = seedBrandIntoHtml(BANDA, { links: [] } as unknown as BusinessProfileData);
    expect(out).toContain("data-ol-platforms-section");
  });

  it("una página sin el marcador queda intacta", () => {
    const html = '<html lang="es"><body><h1>hola</h1></body></html>';
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    expect(seedBrandIntoHtml(html, data)).toContain("<h1>hola</h1>");
  });
});

describe("fillPlatformsBand", () => {
  const STRIP = { whenEmpty: "strip" } as const;

  it("re-sembrar la banda real de buildModuleSection (marcador <div>) no deja HTML desbalanceado", () => {
    const html =
      '<section style="max-width:900px;margin:64px auto;padding:0 24px;box-sizing:border-box;">' +
      '<div style="text-align:center;max-width:620px;margin:0 auto 32px;">' +
      "<p>Plataformas</p><h2>Encuéntrame en</h2><p>Sígueme donde prefieras.</p>" +
      "</div>" +
      "<div data-ol-platforms-section></div>" +
      "</section>";
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    const once = fillPlatformsBand(html, data, STRIP);
    const twice = fillPlatformsBand(once, data, STRIP);
    expect(twice).toBe(once);
    const opens = (twice.match(/<div/g) ?? []).length;
    const closes = (twice.match(/<\/div>/g) ?? []).length;
    expect(closes).toBe(opens);
  });

  it("el marcador dentro de un atributo ajeno NO cuenta — el elemento queda intacto", () => {
    const html = '<div title="see data-ol-platforms-section docs">unrelated</div>';
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    expect(fillPlatformsBand(html, data, STRIP)).toBe(html);
    const empty = { links: [] } as unknown as BusinessProfileData;
    expect(fillPlatformsBand(html, empty, STRIP)).toBe(html);
    expect(fillPlatformsBand(html, empty, { whenEmpty: "keep" })).toBe(html);
  });

  it("dos bandas en el mismo documento: ambas se rellenan", () => {
    const html =
      "<div data-ol-platforms-section></div>" +
      "<p>en medio</p>" +
      "<section data-ol-platforms-section></section>";
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    const out = fillPlatformsBand(html, data, STRIP);
    expect(out.match(/href="https:\/\/twitch\.tv\/kira"/g)?.length).toBe(2);
    expect(out).toContain("<p>en medio</p>");
  });

  it("los genéricos toman el idioma del propio documento", () => {
    const band = "<div data-ol-platforms-section></div>";
    const data = { links: [{ type: "website", url: "tunegocio.mx" }] } as BusinessProfileData;
    const es = fillPlatformsBand(`<html lang="es"><body>${band}</body></html>`, data, STRIP);
    const en = fillPlatformsBand(`<html lang="en">
<body>${band}</body></html>`, data, STRIP);
    expect(es).toContain("Sitio web");
    expect(en).toContain("Website");
    expect(en).not.toContain("Sitio web");
  });

  it("dos bandas en el mismo documento sin plataformas: ambas se borran", () => {
    const html =
      "<div data-ol-platforms-section></div>" +
      "<p>en medio</p>" +
      "<section data-ol-platforms-section></section>";
    const empty = { links: [] } as unknown as BusinessProfileData;
    const out = fillPlatformsBand(html, empty, STRIP);
    expect(out).not.toContain("data-ol-platforms-section");
    expect(out).toContain("<p>en medio</p>");
  });
});

// La MISMA función hacía dos trabajos con una sola política: borrar la banda
// vacía es correcto de cara al visitante y destructivo sobre data.html. El seed
// corre en cada "Guardar" de Mi negocio, así que la sección que el creador
// insertó desaparecía del proyecto sin toast y sin deshacer — y de paso volvía
// inalcanzable el aviso ámbar de Publicar, que solo aparece si la banda existe.
describe("política del caso vacío", () => {
  // La banda REAL que emite el insert — stripBandByMarker solo reconoce como
  // "nuestra" la firma de band() (<section style="max-width:…;margin:64px
  // auto;…">); con un <section> a mano el strip es conservador y deja el
  // encabezado, así que un DOC inventado probaría otra cosa.
  const BAND = buildModuleSection("platforms", { lang: "es" });
  const DOC = `<html lang="es"><body><h1>kira</h1>${BAND}</body></html>`;
  const sinLinks = { links: [] } as unknown as BusinessProfileData;
  // Un enlace capturado pero NO armable: el caso `micafe` del review anterior.
  const soloBasura = {
    links: [{ type: "website", url: "micafe" }],
  } as BusinessProfileData;

  it("sembrar PRESERVA la banda cuando no hay enlaces armables", () => {
    for (const data of [sinLinks, soloBasura]) {
      const out = fillPlatformsBand(DOC, data, { whenEmpty: "keep" });
      expect(out).toContain("data-ol-platforms-section");
      expect(out).toContain("Encuéntrame en");
      expect(out).toContain("<h1>kira</h1>");
    }
  });

  it("sembrar deja el placeholder VACÍO, no las tarjetas rancias del enlace borrado", () => {
    const conTarjeta = fillPlatformsBand(
      DOC,
      { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData,
      { whenEmpty: "keep" },
    );
    expect(conTarjeta).toContain("twitch.tv/kira");
    // El creador borra su único enlace y vuelve a guardar Mi negocio.
    const traseBorrar = fillPlatformsBand(conTarjeta, sinLinks, { whenEmpty: "keep" });
    expect(traseBorrar).not.toContain("twitch.tv/kira");
    expect(traseBorrar).toContain("data-ol-platforms-section");
  });

  it("sembrar sigue siendo IDEMPOTENTE con la política de preservar", () => {
    const once = fillPlatformsBand(DOC, sinLinks, { whenEmpty: "keep" });
    const twice = fillPlatformsBand(once, sinLinks, { whenEmpty: "keep" });
    expect(twice).toBe(once);
    const opens = (twice.match(/<div/g) ?? []).length;
    const closes = (twice.match(/<\/div>/g) ?? []).length;
    expect(closes).toBe(opens);
  });

  it("publicar/preview BORRAN la banda entera — nunca un encabezado sobre un hueco", () => {
    for (const data of [sinLinks, soloBasura]) {
      const out = fillPlatformsBand(DOC, data, { whenEmpty: "strip" });
      expect(out).not.toContain("data-ol-platforms-section");
      expect(out).not.toContain("Encuéntrame en");
      expect(out).toContain("<h1>kira</h1>");
    }
  });

  it("seedBrandIntoHtml (el camino que corre en cada guardado) no destruye la banda", () => {
    const out = seedBrandIntoHtml(DOC, sinLinks);
    expect(out).toContain("data-ol-platforms-section");
    expect(out).toContain("Encuéntrame en");
  });

  it("el aviso ámbar de Publicar queda ALCANZABLE tras guardar sin enlaces", () => {
    // La condición del aviso (page.tsx) es `p.platforms.length > 0 && !platformLinks`.
    // Con la política vieja el primer término daba 0 y el aviso nunca salía.
    const seeded = seedBrandIntoHtml(DOC, sinLinks);
    const placements = modulePlacements({ html: seeded });
    const platformLinks = (sinLinks.links ?? []).filter(platformLinkRenders);
    expect(placements.platforms.length > 0 && platformLinks.length === 0).toBe(true);
  });
});

describe("profileMeta", () => {
  it("maps logo + first photo", () => {
    const m = profileMeta(
      profile({
        brand: { accent: null, logoUrl: "https://x/logo.png" },
        photos: ["https://x/p1.jpg", "https://x/p2.jpg"],
      }),
    );
    expect(m).toEqual({
      logoUrl: "https://x/logo.png",
      ogImage: "https://x/p1.jpg",
    });
  });

  it("is undefined-valued when the profile has no logo/photos", () => {
    expect(profileMeta(profile())).toEqual({
      logoUrl: undefined,
      ogImage: undefined,
    });
  });
});
