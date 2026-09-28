// lib/len-bench/puntuar.test.ts
import { describe, expect, it } from "vitest";
import { notasDeCorrida, puntuarCorrida, resumenPorVia, resumirCaso, salidaDeLaSuite } from "./puntuar";
import type { ResultadoDeCorrida, ResultadoDeGrader } from "./tipos";

const g = (nombre: string, paso: boolean, peso: number, puntua = true): ResultadoDeGrader => ({
  nombre,
  paso,
  peso,
  puntua,
  explicacion: paso ? "bien" : `${nombre} mal`,
});

const corrida = (
  score: number,
  desenlace: ResultadoDeCorrida["desenlace"],
  graders: ResultadoDeGrader[] = [],
  error?: string,
): ResultadoDeCorrida => ({
  graders,
  score,
  desenlace,
  ...(error ? { error } : {}),
  turnosDeLen: 1,
  creditos: 0,
  usd: 0,
  segundos: 1,
  sub: "lb-x",
});

describe("puntuarCorrida", () => {
  it("es la fracción PONDERADA de los que pasan", () => {
    expect(puntuarCorrida([g("a", true, 3), g("b", false, 1)])).toBe(0.75);
  });
  it("un grader que no puntúa no mueve el score, pase o no", () => {
    expect(puntuarCorrida([g("a", true, 1), g("nuevo", false, 5, false)])).toBe(1);
  });
  it("sin nadie que vote, el score es 0 y no NaN", () => {
    expect(puntuarCorrida([g("nuevo", true, 1, false)])).toBe(0);
  });
});

describe("notasDeCorrida", () => {
  it("nombra al que MÁS PESA de los que fallan", () => {
    expect(notasDeCorrida(corrida(0, "completa", [g("leve", false, 1), g("grave", false, 3)]))).toBe("grave: grave mal");
  });
  it("un error de la corrida manda sobre cualquier grader", () => {
    expect(notasDeCorrida(corrida(0, "error_de_len", [g("grave", false, 3)], "turn_limit"))).toBe("turn_limit");
  });
  it("un grader que no puntúa no se nombra", () => {
    expect(notasDeCorrida(corrida(1, "completa", [g("nuevo", false, 9, false)]))).toBe("");
  });
});

describe("resumirCaso", () => {
  it("lo que el arnés no pudo medir cuenta como 0, como en el corredor de evals de Claude Code, y su error manda en las notas", () => {
    // Quitarlas en silencio sacaba el passRate de UNA corrida si fallaban dos,
    // y la tabla no lo decía. Claude Code las cuenta y deja la suite en error.
    const r = resumirCaso("c", "N2", [
      corrida(1, "completa"),
      corrida(0, "proveedor", [], "upstream: 0 tokens"),
      corrida(0, "cliente_fuera_de_ficha", [], "el cliente dijo «$99»"),
    ]);
    expect(r.passRate).toBeCloseTo(1 / 3, 12);
    expect(r.score).toBeCloseTo(1 / 3, 12);
    expect(r.notas).toBe("upstream: 0 tokens");
  });
  it("las que saltó el tope de gasto no se midieron: no cuentan", () => {
    const r = resumirCaso("c", "N2", [corrida(1, "completa"), corrida(0, "tope_de_gasto")]);
    expect(r.passRate).toBe(1);
  });
  it("passRate cuenta sólo las corridas con score 1", () => {
    const r = resumirCaso("c", "N2", [corrida(1, "completa"), corrida(0.5, "completa", [g("x", false, 1)])]);
    expect(r.passRate).toBe(0.5);
    expect(r.score).toBe(0.75);
    expect(r.notas).toBe("x: x mal");
  });
  it("si el tope las saltó todas, lo dice, no inventa un cero", () => {
    const r = resumirCaso("c", "N2", [corrida(0, "tope_de_gasto")]);
    expect(r.notas).toBe("sin corridas medidas: las saltó el tope de gasto");
  });
});

describe("salidaDeLaSuite — los códigos de salida de Claude Code", () => {
  const caso = (desenlaces: ResultadoDeCorrida["desenlace"][]) =>
    resumirCaso("c", "N2", desenlaces.map((d) => corrida(d === "completa" ? 1 : 0, d)));
  it("0 si todo se midió, aunque Len suspenda: la vara ESPERA que suspenda", () => {
    expect(salidaDeLaSuite([caso(["completa", "error_de_len"])], false)).toEqual({ codigo: 0 });
  });
  it("1 si el arnés no pudo medir alguna corrida, y dice cuántas", () => {
    const s = salidaDeLaSuite([caso(["completa", "proveedor"]), caso(["cliente_fuera_de_ficha"])], false);
    expect(s.codigo).toBe(1);
    expect(s.aviso).toMatch(/2 corrida\(s\)/);
  });
  it("2 si la suite quedó a medias por el tope, que manda sobre lo demás", () => {
    expect(salidaDeLaSuite([caso(["proveedor"])], true).codigo).toBe(2);
  });
});

describe("resumenPorVia — capacidad y regresión (decisión 9)", () => {
  const conScores = (id: string, scores: number[]) => resumirCaso(id, "N2", scores.map((s) => corrida(s, "completa")));
  it("la media de la vara sale SÓLO de capacidad; de regresión, cuántos siguen al 100 % y cuáles cayeron", () => {
    const casos = [conScores("a", [1, 0, 0]), conScores("b", [1, 1, 0]), conScores("r1", [1, 1, 1]), conScores("r2", [1, 0.5, 1])];
    expect(resumenPorVia(casos, new Set(["r1", "r2"]))).toEqual({
      capacidad: { casos: 2, passMedio: 0.5 },
      regresion: { casos: 2, alCien: 1, caidos: ["r2"] },
    });
  });
  it("sin vía de regresión (el sellado, un juego nuevo), todo es capacidad", () => {
    expect(resumenPorVia([conScores("a", [1, 1, 1])], new Set())).toEqual({
      capacidad: { casos: 1, passMedio: 1 },
      regresion: { casos: 0, alCien: 0, caidos: [] },
    });
  });
});
