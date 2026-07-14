import { describe, it, expect } from "vitest";
import { behaviorsBakeEnabled, carouselBakeEnabled } from "./kill-switches";

// Hallazgo Fable (2026-07-13): OPENLEN_BEHAVIORS=0 solo se leía en
// lib/publish/filesystem.ts — el inyector del preview (client component) no
// puede leer process.env, así que bajar la palanca en un incidente hacía
// DIVERGIR editor y publicado: el preview seguía inyectando el runtime y la
// publicación dejaba de hornearlo. El mismo hueco existía para
// OPENLEN_CAROUSEL (esta rama le añadió inyector de preview sin palanca).
// Este módulo es el ÚNICO predicado — publish (filesystem.ts) y el endpoint
// que alimenta al preview (app/api/flags) lo comparten, así que las dos
// mitades no pueden volver a divergir por construcción.
describe("kill-switches — el predicado único de OPENLEN_BEHAVIORS/CAROUSEL", () => {
  it('"0" apaga; ausente o cualquier otro valor enciende (default ON)', () => {
    expect(behaviorsBakeEnabled({})).toBe(true);
    expect(behaviorsBakeEnabled({ OPENLEN_BEHAVIORS: "0" })).toBe(false);
    expect(behaviorsBakeEnabled({ OPENLEN_BEHAVIORS: "1" })).toBe(true);
    expect(behaviorsBakeEnabled({ OPENLEN_BEHAVIORS: "" })).toBe(true);
    expect(carouselBakeEnabled({})).toBe(true);
    expect(carouselBakeEnabled({ OPENLEN_CAROUSEL: "0" })).toBe(false);
    expect(carouselBakeEnabled({ OPENLEN_CAROUSEL: "off" })).toBe(true);
  });
});
