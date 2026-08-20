import { describe, expect, it } from "vitest";

import { judgePage } from "./page-scorecard";

// L2 — el brief pide calcular. Determinista como todo lo demás de este
// marcador: o hay fórmula viva y compila, o no. Nunca se juzga si el cálculo
// es el "correcto" — eso sería gusto, y el juez LLM ya se descartó por ruidoso.
describe("el caso que pide calcular", () => {
  const base = { id: "solar", attempts: 1, trimmed: 0, lang: "es", ms: 1 };
  const pide = { expectLang: "es", expectCalc: true } as const;

  it("pasa cuando la página calcula y sus fórmulas compilan", () => {
    expect(judgePage({ ...base, calcFormulas: 3, calcIssues: 0 }, pide).failures).toEqual([]);
  });

  it("falla cuando la página no calcula nada", () => {
    expect(judgePage({ ...base, calcFormulas: 0, calcIssues: 0 }, pide).failures).toEqual(["calc"]);
  });

  // Una región con una fórmula muerta es peor que ninguna: la página parece
  // calcular y no calcula.
  it("falla cuando alguna fórmula nació muerta, aunque otras compilen", () => {
    expect(judgePage({ ...base, calcFormulas: 2, calcIssues: 1 }, pide).failures).toEqual(["calc"]);
  });

  it("un caso que NO pide calcular no se juzga por esto", () => {
    const verdict = judgePage({ ...base, calcFormulas: 0, calcIssues: 0 }, { expectLang: "es" });
    expect(verdict.failures).toEqual([]);
  });
});
