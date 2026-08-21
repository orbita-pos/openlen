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
