// REESCRITO el 2026-08-29. Este fichero probaba cuatro superficies —bookings,
// collections, comments— y las cuatro murieron: dos el 2026-08-21 y las otras
// con el barrido de módulos. Sólo queda `chat`.
//
// Lo que se conserva es lo que NO dependía de qué módulo fuera: que la banda
// salga con los tokens de la marca, que el marcador vaya en un div INTERIOR
// vacío (para que el horneado sustituya sólo eso y el encabezado sobreviva), y
// que sin `lang` caiga a inglés.
import { describe, expect, it } from "vitest";
import { buildModuleSection } from "./module-sections";

describe("buildModuleSection", () => {
  it("chat: banda con los tokens de la marca y su placeholder interior", () => {
    const out = buildModuleSection("chat", { lang: "es" });
    expect(out).toContain("var(--ol-accent");
    expect(out).toContain("Habla directamente con nosotros");
    // El marcador va en un div INTERIOR vacío: el horneado sustituye sólo eso,
    // así que el encabezado de la banda sobrevive.
    expect(out).toContain("<div data-ol-chat-section></div>");
  });

  it("defaults to English when lang is absent/non-es", () => {
    expect(buildModuleSection("chat")).toContain("Talk directly with us");
    expect(buildModuleSection("chat", { lang: "fr" })).toContain("Talk directly with us");
  });
});
