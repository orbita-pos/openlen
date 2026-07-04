import { describe, expect, it } from "vitest";
import {
  buildPostData,
  extractPageLang,
  extractPagePhotos,
  extractRootToken,
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
  it("fills the safe text from profile, falling back to page title", () => {
    const d = buildPostData({
      html: pageHtml, subdomain: "terral", pageTitle: "Café Terral",
      profile: { business_name: "Terral Café", contact: { whatsapp: "5215512345678", phone: "55 1234 5678", address: null, socials: null }, brand: { logoUrl: null, accent: "#AA3311" } } as never,
      userOffer: "2x1 en latte",
    });
    expect(d.businessName).toBe("Terral Café");
    expect(d.offer).toBe("2x1 en latte");
    expect(d.url).toBe("terral.openlen.com");
    expect(d.phone).toBe("55 1234 5678");
    expect(d.logoInitial).toBe("T");
  });
  it("does NOT override the design's accent with the brand color (curated-beauty posture)", () => {
    // Even when the profile carries a brand accent AND the page has a --accent
    // token, the post keeps its own hand-tuned accent — buildPostData emits none.
    const d = buildPostData({
      html: pageHtml, subdomain: null, pageTitle: "Café Terral",
      profile: { business_name: "Terral Café", contact: { whatsapp: null, phone: null, address: null, socials: null }, brand: { logoUrl: null, accent: "#AA3311" } } as never,
    });
    expect(d.accent).toBeUndefined();
  });
  it("works with no profile at all (page-derived name)", () => {
    const d = buildPostData({ html: pageHtml, subdomain: null, profile: null, pageTitle: "Café Terral" });
    expect(d.businessName).toBe("Café Terral");
    expect(d.url).toBeUndefined();
  });
  it("never auto-injects the business's own page images", () => {
    // A page <img> (often a logo/sprite) must not become the post photo — the
    // real ORBITAPOS bug. With no register it stays photo-less; with a register
    // it uses the curated default, not the page image.
    const html = `<html><body><img src="https://x.test/page-logo.webp"></body></html>`;
    expect(buildPostData({ html, subdomain: null, profile: null }).photoUrl).toBeUndefined();
    expect(
      buildPostData({ html, subdomain: null, profile: null, register: "restaurante" }).photoUrl,
    ).toBe(REGISTER_DEFAULT_PHOTOS.restaurante);
  });
  it("defaults to the register's curated photo", () => {
    const html = `<html><body><h1>No photos here</h1></body></html>`;
    const d = buildPostData({ html, subdomain: null, profile: null, register: "restaurante" });
    expect(d.photoUrl).toBe(REGISTER_DEFAULT_PHOTOS.restaurante);
  });
  it("uses an explicit user photoUrl over the register default", () => {
    const html = `<html><body><h1>No photos here</h1></body></html>`;
    const d = buildPostData({
      html, subdomain: null, profile: null,
      register: "restaurante", photoUrl: "https://x.test/mine.webp",
    });
    expect(d.photoUrl).toBe("https://x.test/mine.webp");
  });
  it("stays photo-less for type-first registers (oficios, general)", () => {
    const html = `<html><body><h1>x</h1></body></html>`;
    expect(buildPostData({ html, subdomain: null, profile: null, register: "oficios" }).photoUrl).toBeUndefined();
    expect(buildPostData({ html, subdomain: null, profile: null, register: "general" }).photoUrl).toBeUndefined();
  });
  it("has no photoUrl when there's no register", () => {
    const html = `<html><body><h1>No photos here</h1></body></html>`;
    expect(buildPostData({ html, subdomain: null, profile: null }).photoUrl).toBeUndefined();
  });
});
