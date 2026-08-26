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

});
