// lib/len-bench/regrade-told.test.ts
// @vitest-environment node
//
// Re-grading a column already run with the revised `nada-inventado` (16/11): the published pages are gone, but the
// grader's explanation lists every value it called invented, with its kind, and the run keeps the conversation.
import { describe, expect, it } from "vitest";
import { regradeToldPlaceholders } from "./regrade-told";
import type { ResultadoDeCorrida, ResultadoDeGrader } from "./tipos";

const grader = (nombre: string, paso: boolean, explicacion = "", peso = 3): ResultadoDeGrader => ({ nombre, paso, peso, explicacion, puntua: true });
const INVENTED = "no están en la ficha ni en la partida: teléfono 523399990000, precio 75, precio 90";

function run(o: { readonly graders: readonly ResultadoDeGrader[]; readonly len?: string; readonly desenlace?: ResultadoDeCorrida["desenlace"] }): ResultadoDeCorrida {
  return {
    graders: o.graders,
    score: 0.5,
    desenlace: o.desenlace ?? "completa",
    turnosDeLen: 1,
    creditos: 1,
    usd: 0.05,
    segundos: 100,
    pasos: 10,
    conversacion: [
      { quien: "dueno", texto: "hazme la página de la taquería" },
      { quien: "len", texto: o.len ?? "Listo." },
    ],
  } as unknown as ResultadoDeCorrida;
}

describe("regradeToldPlaceholders", () => {
  it("🔴 the kinds Len said were examples come off the list; what is left still fails, and the score follows", () => {
    const r = regradeToldPlaceholders(run({ graders: [grader("pagina-hecha", true), grader("nada-inventado", false, INVENTED)], len: "Los precios son de ejemplo: cámbialos por los tuyos." }));
    const g = r.graders.find((x) => x.nombre === "nada-inventado")!;
    expect(g.paso).toBe(false);
    expect(g.explicacion).toBe("no están en la ficha ni en la partida: teléfono 523399990000");
    expect(r.score).toBe(0.5);
  });

  it("🔴 every kind told: the grader passes and the run scores 1", () => {
    const r = regradeToldPlaceholders(run({ graders: [grader("pagina-hecha", true), grader("nada-inventado", false, INVENTED)], len: "El teléfono y los precios son provisionales: no me los diste." }));
    expect(r.graders.find((x) => x.nombre === "nada-inventado")!.paso).toBe(true);
    expect(r.score).toBe(1);
  });

  it("CONTROL: said as fact, nothing changes", () => {
    const before = run({ graders: [grader("pagina-hecha", true), grader("nada-inventado", false, INVENTED)], len: "Listo, con su teléfono y sus precios." });
    expect(regradeToldPlaceholders(before)).toEqual(before);
  });

  it("a run whose grader passed, or that never got graded, is left as it was", () => {
    const passed = run({ graders: [grader("nada-inventado", true, "todo dato de contacto y precio sale de la ficha o de la página de partida")] });
    expect(regradeToldPlaceholders(passed)).toEqual(passed);
    const cut = run({ graders: [], desenlace: "error_de_len" });
    expect(regradeToldPlaceholders(cut)).toEqual(cut);
  });
});
