// The inspector's Link → Destination field is the no-AI path for setting an
// href, so it's the path a non-technical creator actually types into. These
// lock the two halves of the contract: a scheme-less value gets the scheme it
// obviously already is (otherwise it's a relative path that silently serves the
// home page with 200 — see normalize-href.ts), and an already-addressed value
// is never touched, byte-for-byte.

import { describe, it, expect } from "vitest";
import { normalizeHref } from "./normalize-href";

describe("normalizeHref — adds the scheme a bare value obviously already has", () => {
  it("absolutizes a bare host", () => {
    expect(normalizeHref("instagram.com/cafelaesquina")).toBe("https://instagram.com/cafelaesquina");
    expect(normalizeHref("www.midominio.mx")).toBe("https://www.midominio.mx");
    expect(normalizeHref("linktr.ee/cafe?src=bio")).toBe("https://linktr.ee/cafe?src=bio");
  });
  it("preserves case and query string verbatim while prefixing", () => {
    expect(normalizeHref("Instagram.com/Juan?ref=Bio&x=1")).toBe(
      "https://Instagram.com/Juan?ref=Bio&x=1",
    );
  });
  it("trims surrounding whitespace from a paste", () => {
    expect(normalizeHref("  https://x.com/a  ")).toBe("https://x.com/a");
    expect(normalizeHref(" tienda.mx ")).toBe("https://tienda.mx");
  });
  it("routes a bare email to mailto: and a bare phone to tel:", () => {
    expect(normalizeHref("hola@cafe.com")).toBe("mailto:hola@cafe.com");
    expect(normalizeHref("+52 55 1234 5678")).toBe("tel:+525512345678");
    expect(normalizeHref("(55) 1234-5678")).toBe("tel:5512345678");
  });
});

describe("normalizeHref — never touches a value that's already addressable", () => {
  it("leaves every scheme alone", () => {
    for (const v of [
      "https://a.com/b?c=1#d",
      "http://a.com",
      "mailto:hola@cafe.com",
      "tel:+525512345678",
      "https://wa.me/525512345678?text=Hola%20quiero%20pedir",
    ]) {
      expect(normalizeHref(v)).toBe(v);
    }
  });
  it("leaves anchors, root paths and explicit relatives alone", () => {
    for (const v of ["#precios", "/menu", "/menu/", "./gracias.html", "../index.html", "//cdn.x.com/a"]) {
      expect(normalizeHref(v)).toBe(v);
    }
  });
  it("leaves an empty value empty (clearing the field still clears the href)", () => {
    expect(normalizeHref("")).toBe("");
    expect(normalizeHref("   ")).toBe("");
  });
  it("does not guess a destination it wasn't given", () => {
    // A handle names no platform, and a lone word may be an intended relative
    // path — inventing "https://instagram.com/juan" out of "@juan" would be the
    // same sin as an invented link. Left exactly as typed.
    expect(normalizeHref("@juan")).toBe("@juan");
    expect(normalizeHref("menu")).toBe("menu");
  });
});
