import { describe, it, expect } from "vitest";
import { transformEnabled, liveDataEnabled } from "./kill-switches";

// ⚰️ El describe de OPENLEN_BEHAVIORS/CAROUSEL se fue el 2026-08-31 con sus dos
// predicados: gobernaban horneados que salieron de publicar el 2026-08-26, y su
// único consumidor era `/api/flags`, que sólo existía para que el taller
// obedeciera la misma palanca. Sin la mitad de publicar, la palanca creaba la
// divergencia que se escribió para impedir.

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
