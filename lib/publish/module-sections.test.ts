import { describe, expect, it } from "vitest";
import { buildModuleSection } from "./module-sections";

describe("buildModuleSection", () => {
  it("bookings: brand-matched band + inner empty placeholder (heading survives the bake)", () => {
    const out = buildModuleSection("bookings", { lang: "es" });
    expect(out).toContain("var(--ol-accent");
    expect(out).toContain("Agenda una cita");
    // marker on an INNER empty div so the bake swaps only that (band heading stays)
    expect(out).toContain("<div data-ol-bookings-section></div>");
  });

  it("collections: wide band + its placeholder", () => {
    const out = buildModuleSection("collections", { lang: "en" });
    expect(out).toContain("<div data-ol-collection-section></div>");
    expect(out).toContain("max-width:1100px");
    expect(out).toContain("What we offer");
  });

  it("comments: its placeholder + Spanish copy", () => {
    const out = buildModuleSection("comments", { lang: "es-MX" });
    expect(out).toContain("<div data-ol-comments-section></div>");
    expect(out).toContain("Lo que opina la gente");
  });

  it("defaults to English when lang is absent/non-es", () => {
    expect(buildModuleSection("bookings")).toContain("Book an appointment");
    expect(buildModuleSection("bookings", { lang: "fr" })).toContain("Book an appointment");
  });

  it("whatsapp: a static CTA with a wa.me link (no placeholder)", () => {
    const out = buildModuleSection("whatsapp", {
      lang: "es",
      whatsapp: { number: "5512345678", message: "Hola" },
    });
    expect(out).toContain("https://wa.me/525512345678?text=Hola");
    expect(out).toContain("Escribir por WhatsApp");
    expect(out).not.toContain("data-ol-whatsapp-section");
    expect(out).not.toContain("data-ol-bookings-section");
  });

  it("whatsapp: empty when there is no usable number", () => {
    expect(buildModuleSection("whatsapp", { whatsapp: { number: "" } })).toBe("");
    expect(buildModuleSection("whatsapp", { whatsapp: { number: "12" } })).toBe("");
  });

  it("escapes copy + the whatsapp href", () => {
    const out = buildModuleSection("whatsapp", {
      whatsapp: { number: "5512345678", message: 'a"b' },
    });
    expect(out).not.toContain('text=a"b');
    expect(out).toContain("text=a%22b");
  });
});
