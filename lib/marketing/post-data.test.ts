import { describe, expect, it } from "vitest";
import {
  buildPostData,
  extractPageContact,
  extractPageLang,
  extractPagePhotos,
  extractRootToken,
  parsePhotoPos,
  REGISTER_DEFAULT_PHOTOS,
} from "./post-data";

const pageHtml = `<html><head><style>:root{--accent:#2F6B3E;--bg:#FBF7EF}</style></head><body><h1>Café Terral</h1></body></html>`;

describe("extractRootToken", () => {
  it("pulls a css var from :root", () => {
    expect(extractRootToken(pageHtml, "--accent")).toBe("#2F6B3E");
    expect(extractRootToken(pageHtml, "--missing")).toBeNull();
  });
});

describe("extractPagePhotos", () => {
  it("dedupes, skips relative srcs, caps at 12, keeps first-seen order", () => {
    const imgs = Array.from({ length: 14 }, (_, i) => `<img src="https://pics.test/p${i + 1}.webp">`);
    // duplicate of p1 after p3 + a relative src, neither may appear in output
    imgs.splice(3, 0, `<img src="https://pics.test/p1.webp">`, `<img src="/local.png">`);
    const photos = extractPagePhotos(`<html><body>${imgs.join("")}</body></html>`);
    expect(photos).toHaveLength(12);
    expect(new Set(photos).size).toBe(12);
    expect(photos).not.toContain("/local.png");
    expect(photos).toEqual(
      Array.from({ length: 12 }, (_, i) => `https://pics.test/p${i + 1}.webp`),
    );
  });
});

describe("extractPageLang", () => {
  it("maps any es-* subtag to es", () => {
    expect(extractPageLang(`<html lang="es">`)).toBe("es");
    expect(extractPageLang(`<html lang="es-MX">`)).toBe("es");
    expect(extractPageLang(`<html lang="ES-419">`)).toBe("es");
  });
  it("maps non-es langs to en", () => {
    expect(extractPageLang(`<html lang="en">`)).toBe("en");
    expect(extractPageLang(`<html lang="fr">`)).toBe("en");
  });
  it("defaults to es when the attribute is missing (es-MX-first product)", () => {
    expect(extractPageLang(`<html>`)).toBe("es");
    expect(extractPageLang(`<html class="dark">`)).toBe("es");
  });
});

describe("buildPostData", () => {
  // ⚰️ Esta prueba fijaba que el nombre, el teléfono y el WhatsApp salían del
  // PERFIL de negocio. Su inversa, desde el 2026-08-31: salen de la PÁGINA.
  it("saca el contacto de la PÁGINA, no de una ficha", () => {
    const html =
      `<html><head><style>:root{--accent:#2F6B3E}</style></head><body>` +
      `<a href="tel:+52 55 1234 5678">Llámanos</a>` +
      `<a href="https://wa.me/5215512345678">WhatsApp</a>` +
      `</body></html>`;
    const d = buildPostData({
      html, subdomain: "terral", pageTitle: "Café Terral",
      userOffer: "2x1 en latte",
    });
    expect(d.businessName).toBe("Café Terral");
    expect(d.offer).toBe("2x1 en latte");
    expect(d.phone).toBe("+52 55 1234 5678");
    expect(d.whatsapp).toBe("5215512345678");
    expect(d.logoInitial).toBe("C");
  });

  // BRAZO DE CONTROL de la de arriba: una página SIN enlaces de contacto deja
  // los huecos vacíos. Sin esto, un extractor que devolviera cualquier cosa
  // pasaría la prueba anterior igual.
  it("una página sin teléfono deja el hueco vacío, no lo inventa", () => {
    const d = buildPostData({ html: pageHtml, subdomain: null, pageTitle: "Café Terral" });
    expect(d.phone).toBeUndefined();
    expect(d.whatsapp).toBeUndefined();
  });

  it("MATCHES the page: derives a contrast-safe palette + font (not the raw brand color)", () => {
    const html = `<html><head><style>:root{--accent:#AA3311;--bg:#FBF7EF;--display:'Poppins',sans-serif}</style></head><body></body></html>`;
    const d = buildPostData({ html, subdomain: null, pageTitle: "Terral" });
    expect(d.accent).toBeTruthy();
    expect(d.accent).not.toBe("#AA3311"); // contrast-adjusted, never the raw brand hex
    expect(d.bg).toBeTruthy();
    expect(d.ink).toBeTruthy();
    expect(d.fontFamily).toBe("Poppins");
    expect(d.fontHref).toContain("fonts.googleapis.com");
  });
  it("match:false keeps the design's curated look (no palette/font override)", () => {
    const html = `<html><head><style>:root{--accent:#AA3311;--bg:#FBF7EF;--display:'Poppins',sans-serif}</style></head></html>`;
    const d = buildPostData({ html, subdomain: null, match: false });
    expect(d.accent).toBeUndefined();
    expect(d.bg).toBeUndefined();
    expect(d.fontFamily).toBeUndefined();
  });
  it("no brand color anywhere → stays fully curated", () => {
    const d = buildPostData({ html: `<html><body><h1>no tokens</h1></body></html>`, subdomain: null });
    expect(d.accent).toBeUndefined();
    expect(d.fontFamily).toBeUndefined();
  });
  it("el nombre sale del título de la página", () => {
    const d = buildPostData({ html: pageHtml, subdomain: null, pageTitle: "Café Terral" });
    expect(d.businessName).toBe("Café Terral");
    expect(d.url).toBeUndefined();
  });
  it("never auto-injects the business's own page images", () => {
    // A page <img> (often a logo/sprite) must not become the post photo — the
    // real ORBITAPOS bug. With no register it stays photo-less; with a register
    // it uses the curated default, not the page image.
    const html = `<html><body><img src="https://x.test/page-logo.webp"></body></html>`;
    expect(buildPostData({ html, subdomain: null }).photoUrl).toBeUndefined();
    expect(
      buildPostData({ html, subdomain: null, register: "restaurante" }).photoUrl,
    ).toBe(REGISTER_DEFAULT_PHOTOS.restaurante);
  });
  it("defaults to the register's curated photo", () => {
    const html = `<html><body><h1>No photos here</h1></body></html>`;
    const d = buildPostData({ html, subdomain: null, register: "restaurante" });
    expect(d.photoUrl).toBe(REGISTER_DEFAULT_PHOTOS.restaurante);
  });
  it("uses an explicit user photoUrl over the register default", () => {
    const html = `<html><body><h1>No photos here</h1></body></html>`;
    const d = buildPostData({
      html, subdomain: null,
      register: "restaurante", photoUrl: "https://x.test/mine.webp",
    });
    expect(d.photoUrl).toBe("https://x.test/mine.webp");
  });
  it("stays photo-less for type-first registers (oficios, general)", () => {
    const html = `<html><body><h1>x</h1></body></html>`;
    expect(buildPostData({ html, subdomain: null, register: "oficios" }).photoUrl).toBeUndefined();
    expect(buildPostData({ html, subdomain: null, register: "general" }).photoUrl).toBeUndefined();
  });
  it("has no photoUrl when there's no register", () => {
    const html = `<html><body><h1>No photos here</h1></body></html>`;
    expect(buildPostData({ html, subdomain: null }).photoUrl).toBeUndefined();
  });
});

describe("parsePhotoPos", () => {
  it("maps x,y → object-position, clamps 0-100, rejects junk", () => {
    expect(parsePhotoPos("50,30")).toBe("50% 30%");
    expect(parsePhotoPos("200,300")).toBe("100% 100%");
    expect(parsePhotoPos("0,0")).toBe("0% 0%");
    expect(parsePhotoPos("50")).toBeUndefined();
    expect(parsePhotoPos("-5,10")).toBeUndefined();
    expect(parsePhotoPos("a,b")).toBeUndefined();
    expect(parsePhotoPos(null)).toBeUndefined();
  });
});

// Las dos formas de WhatsApp que escribe el modelo, y lo que NO cuenta. El
// extractor mira `href`, así que un número suelto en el texto no lo dispara —
// deliberado: «llama al 55 1234 5678» dentro de un párrafo es prosa, y un
// teléfono equivocado en un cartel se publica.
describe("extractPageContact", () => {
  it("lee wa.me y api.whatsapp.com", () => {
    expect(
      extractPageContact(`<a href="https://wa.me/5215512345678">x</a>`).whatsapp,
    ).toBe("5215512345678");
    expect(
      extractPageContact(
        `<a href="https://api.whatsapp.com/send?phone=5215599998888&text=hola">x</a>`,
      ).whatsapp,
    ).toBe("5215599998888");
  });

  it("se queda con el PRIMERO de cada uno", () => {
    const html =
      `<a href="tel:+521111">uno</a><a href="tel:+522222">dos</a>` +
      `<a href="https://wa.me/5213333">tres</a><a href="https://wa.me/5214444">cuatro</a>`;
    const c = extractPageContact(html);
    expect(c.phone).toBe("+521111");
    expect(c.whatsapp).toBe("5213333");
  });

  it("un teléfono en el TEXTO no cuenta — sólo los href", () => {
    const c = extractPageContact(`<p>Llámanos al 55 1234 5678</p>`);
    expect(c.phone).toBeUndefined();
    expect(c.whatsapp).toBeUndefined();
  });

  it("una página sin enlaces devuelve el objeto vacío", () => {
    expect(extractPageContact(`<html><body><h1>x</h1></body></html>`)).toEqual({});
  });
});
