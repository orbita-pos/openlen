import { describe, it, expect } from "vitest";
import { seedBrandIntoHtml, fillPlatformsBand, profileMeta } from "./seed-html";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
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

  it("sin plataformas BORRA la banda entera, no deja un encabezado huérfano", () => {
    const out = seedBrandIntoHtml(BANDA, { links: [] } as unknown as BusinessProfileData);
    expect(out).not.toContain("data-ol-platforms-section");
  });

  it("una página sin el marcador queda intacta", () => {
    const html = '<html lang="es"><body><h1>hola</h1></body></html>';
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    expect(seedBrandIntoHtml(html, data)).toContain("<h1>hola</h1>");
  });
});

describe("fillPlatformsBand", () => {
  it("re-sembrar la banda real de buildModuleSection (marcador <div>) no deja HTML desbalanceado", () => {
    const html =
      '<section style="max-width:900px;margin:64px auto;padding:0 24px;box-sizing:border-box;">' +
      '<div style="text-align:center;max-width:620px;margin:0 auto 32px;">' +
      "<p>Plataformas</p><h2>Encuéntrame en</h2><p>Sígueme donde prefieras.</p>" +
      "</div>" +
      "<div data-ol-platforms-section></div>" +
      "</section>";
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    const once = fillPlatformsBand(html, data);
    const twice = fillPlatformsBand(once, data);
    expect(twice).toBe(once);
    const opens = (twice.match(/<div/g) ?? []).length;
    const closes = (twice.match(/<\/div>/g) ?? []).length;
    expect(closes).toBe(opens);
  });

  it("el marcador dentro de un atributo ajeno NO cuenta — el elemento queda intacto", () => {
    const html = '<div title="see data-ol-platforms-section docs">unrelated</div>';
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    expect(fillPlatformsBand(html, data)).toBe(html);
    const empty = { links: [] } as unknown as BusinessProfileData;
    expect(fillPlatformsBand(html, empty)).toBe(html);
  });

  it("dos bandas en el mismo documento: ambas se rellenan", () => {
    const html =
      "<div data-ol-platforms-section></div>" +
      "<p>en medio</p>" +
      "<section data-ol-platforms-section></section>";
    const data = { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData;
    const out = fillPlatformsBand(html, data);
    expect(out.match(/href="https:\/\/twitch\.tv\/kira"/g)?.length).toBe(2);
    expect(out).toContain("<p>en medio</p>");
  });

  it("los genéricos toman el idioma del propio documento", () => {
    const band = "<div data-ol-platforms-section></div>";
    const data = { links: [{ type: "website", url: "tunegocio.mx" }] } as BusinessProfileData;
    const es = fillPlatformsBand(`<html lang="es"><body>${band}</body></html>`, data);
    const en = fillPlatformsBand(`<html lang="en">
<body>${band}</body></html>`, data);
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
    const out = fillPlatformsBand(html, empty);
    expect(out).not.toContain("data-ol-platforms-section");
    expect(out).toContain("<p>en medio</p>");
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
