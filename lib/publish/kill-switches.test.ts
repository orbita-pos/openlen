import { describe, it, expect } from "vitest";
import { behaviorsBakeEnabled, carouselBakeEnabled, transformEnabled, liveDataEnabled } from "./kill-switches";

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

// Transform de ingestión (spec 2026-07-14): mismo contrato que los dos de
// arriba — "0" apaga, todo lo demás enciende.
describe("kill-switches — OPENLEN_TRANSFORM", () => {
  it('"0" apaga; ausente o cualquier otro valor enciende', () => {
    expect(transformEnabled({})).toBe(true);
    expect(transformEnabled({ OPENLEN_TRANSFORM: "0" })).toBe(false);
    expect(transformEnabled({ OPENLEN_TRANSFORM: "1" })).toBe(true);
  });
});

// Datos vivos (Task 1, spec 2026-07-14): mismo contrato que los de arriba —
// "0" apaga, todo lo demás enciende (default ON).
describe("kill-switches — OPENLEN_LIVE_DATA", () => {
  it('"0" apaga; ausente o cualquier otro valor enciende', () => {
    expect(liveDataEnabled({})).toBe(true);
    expect(liveDataEnabled({ OPENLEN_LIVE_DATA: "0" })).toBe(false);
    expect(liveDataEnabled({ OPENLEN_LIVE_DATA: "1" })).toBe(true);
  });
});
