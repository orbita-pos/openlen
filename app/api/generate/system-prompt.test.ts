import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT } from "./system-prompt";

/**
 * LA DIRECTIVA DE ESTRUCTURA, Y POR QUÉ EXISTE.
 *
 * Medido 2026-08-20 sobre 14 páginas de briefs muy distintos —terror, colorear
 * para niños, club de comedia, videojuego, escuela, panadería—: TODAS salieron
 * `nav → header → 3-5 section → footer`. Nadie se lo pedía; el prompt le
 * entrega la estructura al modelo explícitamente. Es su atractor.
 *
 * Con la directiva, en un A/B de 6 briefs (0,63 MXN): la forma canónica pasó de
 * 5/6 a 2/6 y la rejilla de tres columnas de 5/6 a 2/6, sin una sola página
 * rota — 0 texto bajo 4.5:1 y 0 desborde horizontal en las que se renderizaron.
 *
 * Este test es lo que impide que se caiga en un refactor sin que nadie lo note:
 * volvería el esqueleto único y no habría ningún síntoma que lo delatara.
 */
describe("la directiva de estructura sigue en el prompt", () => {
  it("nombra los tres hábitos que se midieron", () => {
    expect(SYSTEM_PROMPT).toContain("ESTRUCTURA");
    for (const habito of ["tarjetas de tres en tres", "héroe centrado", "porque parece que falta"]) {
      expect(SYSTEM_PROMPT, `la directiva ya no nombra: ${habito}`).toContain(habito);
    }
  });

  // La primera redacción los PROHIBÍA y sobre-corrigió: le quitó el índice a un
  // ensayo largo, que es justo donde un índice sirve. La directiva pide
  // decidir, no obedecer — y eso también hay que sostenerlo.
  it("pide elegirlos, no prohibirlos", () => {
    expect(SYSTEM_PROMPT).toContain("ELEGIR, no heredar");
    expect(SYSTEM_PROMPT).toContain("Consérvalos cuando esta página los pida");
  });

  it("no toca lo que el prompt ya prometía: la estructura es del modelo", () => {
    expect(SYSTEM_PROMPT).toContain("are yours to decide");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// El interruptor del contrato mínimo (2026-08-21).
// ───────────────────────────────────────────────────────────────────────────

import { systemPromptFor } from "./system-prompt";
import { PUBLISH_CONTRACT } from "@/lib/design-guidance";
import { PUBLISH_CONTRACT_MIN } from "@/lib/publish-contract-min";

const min = () => systemPromptFor({ OPENLEN_MIN_CONTRACT: "1" });

describe("el interruptor del contrato mínimo", () => {
  it("apagado, el prompt es EXACTAMENTE el de hoy", () => {
    expect(systemPromptFor({})).toBe(SYSTEM_PROMPT);
    expect(systemPromptFor({ OPENLEN_MIN_CONTRACT: "0" })).toBe(SYSTEM_PROMPT);
    // Sólo el literal "1" enciende: un "true" no puede cambiar producción por
    // accidente.
    expect(systemPromptFor({ OPENLEN_MIN_CONTRACT: "true" })).toBe(SYSTEM_PROMPT);
  });

  it("encendido, la sustitución OCURRE — si no, el brazo sería falso", () => {
    const out = min();
    expect(out).not.toBe(SYSTEM_PROMPT);
    expect(out).not.toContain(PUBLISH_CONTRACT);
    expect(out).toContain(PUBLISH_CONTRACT_MIN);
    expect(out.length).toBeLessThan(SYSTEM_PROMPT.length * 0.4);
  });

  // La directiva de arriba vive FUERA del contrato, así que el recorte no
  // puede llevársela por delante.
  it("la directiva de estructura sobrevive al recorte", () => {
    expect(min()).toContain("ESTRUCTURA");
    expect(min()).toContain("ELEGIR, no heredar");
  });
});

/** Lo que el recorte NO puede perder: cada una rompe la página publicada. */
describe("lo obligatorio sobrevive al recorte", () => {
  const OBLIGATORIO: [string, RegExp][] = [
    ["documento completo", /<!doctype html>/i],
    ["Tailwind por CDN", /cdn\.tailwindcss\.com/],
    ["Google Fonts", /fonts\.googleapis\.com/],
    ["nada de iframe", /iframe/i],
    ["data-slot-path prohibido", /data-slot-path/],
    ["marcadores de foto", /data-ol-photo/],
    ["href absoluto con esquema", /mailto:/],
    ["vocabulario de tokens", /--accent-ink/],
    ["360 px", /360\s?px/],
  ];
  for (const [nombre, re] of OBLIGATORIO) {
    it(`conserva: ${nombre}`, () => expect(min()).toMatch(re));
  }
});

/**
 * La hipótesis que este interruptor existe para poder probar: que el
 * vocabulario de página y los ejemplos de markup fijan la forma antes de que el
 * brief hable. Si algo se cuela, el brazo deja de medir lo que dice medir.
 */
describe("lo que el recorte tiene que haber quitado", () => {
  it("cero vocabulario de arquitectura de página", () => {
    const coladas = ["landing", "marketing", "hero", "carousel", "carrusel", "testimoni"]
      .filter((p) => new RegExp(p, "i").test(PUBLISH_CONTRACT_MIN));
    expect(coladas).toEqual([]);
  });

  it("casi ningún ejemplo de HTML — el actual trae decenas", () => {
    const etiquetas = (t: string) =>
      [...t.matchAll(/<(section|div|nav|header|article|button|ul|li|a|img|code|p|span)\b/gi)].length;
    // Los dos que quedan son literales obligatorios: el <script> de Tailwind y
    // el <style> del <head>.
    expect(etiquetas(PUBLISH_CONTRACT_MIN)).toBeLessThanOrEqual(2);
    expect(etiquetas(PUBLISH_CONTRACT)).toBeGreaterThan(20);
  });

  it("las nueve CONDUCTAS quedan FUERA — pérdida CONOCIDA, no descuido", () => {
    // Sin esto el modelo no emite los marcadores y las páginas nacen sin
    // countdown, filtro, lightbox… Antes de encender esto en producción hay que
    // inyectar la receta que el brief pida, no las nueve siempre.
    expect(PUBLISH_CONTRACT_MIN).not.toContain("data-ol-countdown");
    expect(PUBLISH_CONTRACT).toContain("data-ol-countdown");
  });
});
