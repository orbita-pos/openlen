import { describe, it, expect } from "vitest";
import { seedBrandIntoHtml, profileMeta } from "./seed-html";
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

  // ⚰️ Aquí había cuatro pruebas del sembrado de la BANDA de plataformas, y
  // debajo un `describe("fillPlatformsBand")` entero. La banda murió el
  // 2026-08-29: era un TECHO —el prompt le decía al modelo que las redes SON
  // una banda—, así que nunca le proponía a nadie una sección propia ni una
  // página por red.
  //
  // Lo que fijaban y ya no aplica: que sembrar la RELLENARA, que re-sembrar no
  // la duplicara, y que sembrar la PRESERVARA aunque quedara vacía (borrarla
  // era cosa de publicar, no de sembrar — porque sembrar corre en cada guardado
  // de Mi negocio y no podía destruir una sección que el creador insertó).
  //
  // Los ENLACES siguen en el perfil: sin ellos el modelo se inventaría los
  // @usuario, que es el peor dato falso posible.
});
