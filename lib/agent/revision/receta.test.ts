import { describe, expect, it } from "vitest";
import {
  MAX_POR_BUSCADOR,
  MAX_UNA_PASADA,
  SISTEMA_DEL_REVISOR,
  encargoDeUnaPasada,
  encargoDelBuscador,
  encargoDelVerificador,
  leerCandidatos,
  leerVeredicto,
  tareaDeRevision,
} from "./receta";

const candidato = (o: Record<string, unknown> = {}) => ({
  file: "/index.html",
  line: 12,
  summary: "the hero headline was rewritten",
  failure_scenario: "the owner's brand phrase is gone from the home page",
  ...o,
});

describe("los prompts de la receta", () => {
  it("el sistema es el MISMO para todos los revisores, y sin ángulo: lo propio va al final", () => {
    expect(SISTEMA_DEL_REVISOR).toContain("read-only");
    expect(SISTEMA_DEL_REVISOR).not.toContain("Angle");
  });

  it("cada buscador lleva SU ángulo, el tope de 6 y la regla de no censurarse", () => {
    const s = encargoDelBuscador("procedencia");
    expect(s).toContain("Angle C — provenance");
    expect(s).not.toContain("Angle A — scope");
    expect(s).toContain(`up to ${MAX_POR_BUSCADOR}`);
    expect(s).toContain("dominant cause of misses");
  });

  it("la pasada única lleva los cuatro ángulos, el tope de 4 y pide la categoría", () => {
    const s = encargoDeUnaPasada();
    for (const a of ["Angle A", "Angle B", "Angle C", "Angle D"]) expect(s).toContain(a);
    expect(s).toContain(`at most ${MAX_UNA_PASADA}`);
    expect(s).toContain('"category"');
    expect(s).toContain("`said-vs-done`");
  });

  it("el buscador no pide categoría: su ángulo ya se sabe", () => {
    expect(encargoDelBuscador("alcance")).not.toContain('"category"');
  });

  it("el verificador tiene tres salidas y refuta sólo con la cita", () => {
    const s = encargoDelVerificador(candidato());
    for (const v of ["CONFIRMED", "PLAUSIBLE", "REFUTED"]) expect(s).toContain(`**${v}**`);
    expect(s).toMatch(/REFUTED.*Quote/);
  });

  it("la tarea lleva la petición, el diff y el cierre, cada uno en su etiqueta", () => {
    const t = tareaDeRevision({ peticion: " pon el teléfono ", diff: "+<p>55 1234</p>", cierre: "Listo." });
    expect(t).toContain("<user_request>\npon el teléfono\n</user_request>");
    expect(t).toContain("<diff>\n+<p>55 1234</p>\n</diff>");
    expect(t).toContain("<agent_closing_message>\nListo.\n</agent_closing_message>");
  });

  it("lo que el usuario escribió antes va DELANTE y aparte, numerado; vacío, no aparece", () => {
    const t = tareaDeRevision({ peticion: "ponlas", anteriores: ["pon reseñas", "  ", "Lucía: «vuelvo cada jueves»"], diff: "d", cierre: "c" });
    expect(t.startsWith("<earlier_user_messages>\n[1] pon reseñas\n[2] Lucía: «vuelvo cada jueves»\n</earlier_user_messages>\n\n<user_request>")).toBe(true);
    expect(tareaDeRevision({ peticion: "x", anteriores: [], diff: "d", cierre: "c" })).not.toContain("earlier_user_messages");
  });

  it("un cierre vacío se dice, no se deja en blanco", () => {
    expect(tareaDeRevision({ peticion: "x", diff: "y", cierre: "  " })).toContain("(the agent wrote no closing message)");
  });

  it("el verificador lleva el candidato con sus cuatro campos, sin nuestro ángulo", () => {
    const t = encargoDelVerificador({ ...candidato(), angulo: "quitado" });
    expect(t).toContain('<candidate>\n{"file":"/index.html","line":12,"summary"');
    expect(t).not.toContain("quitado");
  });
});

describe("leer los candidatos", () => {
  it("el array tal cual", () => {
    expect(leerCandidatos(JSON.stringify([candidato()]), 6)).toEqual([candidato()]);
  });

  it("dentro de un bloque ```json y con prosa alrededor", () => {
    const raw = "I found one:\n```json\n" + JSON.stringify([candidato()]) + "\n```\nThat's all.";
    expect(leerCandidatos(raw, 6)).toEqual([candidato()]);
  });

  it("con corchetes en la prosa de DELANTE, que el corte ingenuo juntaba", () => {
    const raw = `At [Line 12] something changed.\n${JSON.stringify([candidato()])}`;
    expect(leerCandidatos(raw, 6)).toHaveLength(1);
  });

  it("con corchetes y llaves DENTRO de las cadenas", () => {
    const c = candidato({ summary: "the rule .a { color: red } and [data-x] went away" });
    expect(leerCandidatos(JSON.stringify([c]), 6)?.[0]?.summary).toBe(c.summary);
  });

  it("`[]` es «nada que marcar», no una respuesta rota", () => {
    expect(leerCandidatos("[]", 6)).toEqual([]);
    expect(leerCandidatos("Nothing qualifies.\n\n```json\n[]\n```", 6)).toEqual([]);
  });

  it("🔴 sin array, `null`: una respuesta ilegible NO es «sin hallazgos»", () => {
    expect(leerCandidatos("No issues found.", 6)).toBeNull();
    expect(leerCandidatos('{"file": "/index.html"}', 6)).toBeNull();
    expect(leerCandidatos("[{broken json", 6)).toBeNull();
  });

  it("un `[1, 2]` citado delante no se toma por la lista", () => {
    const raw = `The script sets items = [1, 2].\n${JSON.stringify([candidato()])}`;
    expect(leerCandidatos(raw, 6)).toHaveLength(1);
  });

  it("descarta uno a uno lo que no tiene la forma, y se queda el resto", () => {
    const raw = JSON.stringify([
      candidato({ summary: "" }),
      "not an object",
      candidato({ failure_scenario: undefined }),
      candidato({ file: 3 }),
      candidato({ summary: "kept" }),
    ]);
    expect(leerCandidatos(raw, 6)?.map((c) => c.summary)).toEqual(["kept"]);
  });

  it("corta en el tope", () => {
    const raw = JSON.stringify(Array.from({ length: 9 }, (_, i) => candidato({ line: i + 1 })));
    expect(leerCandidatos(raw, MAX_POR_BUSCADOR)).toHaveLength(MAX_POR_BUSCADOR);
    expect(leerCandidatos(raw, MAX_UNA_PASADA)?.map((c) => c.line)).toEqual([1, 2, 3, 4]);
  });

  it("la ruta del sitio siempre empieza por /", () => {
    expect(leerCandidatos(JSON.stringify([candidato({ file: "menu/index.html" })]), 6)?.[0]?.file).toBe("/menu/index.html");
  });

  it("🔴 una línea que falta o no vale es `null`, no una línea 1 inventada", () => {
    const raw = JSON.stringify([
      candidato({ line: null }),
      candidato({ line: 0 }),
      candidato({ line: "abc" }),
      candidato({ line: undefined }),
      candidato({ line: "40" }),
      candidato({ line: 7.9 }),
    ]);
    expect(leerCandidatos(raw, 6)?.map((c) => c.line)).toEqual([null, null, null, null, 40, 7]);
  });

  it("el `category` de la pasada única se lee como ángulo; uno desconocido no", () => {
    const raw = JSON.stringify([
      candidato({ category: "said-vs-done" }),
      candidato({ category: " Provenance " }),
      candidato({ category: "correctness" }),
    ]);
    const cs = leerCandidatos(raw, 6)!;
    expect(cs.map((c) => c.angulo)).toEqual(["dicho", "procedencia", undefined]);
    expect("angulo" in cs[2]).toBe(false);
  });
});

describe("leer el veredicto", () => {
  it("las tres salidas, en mayúsculas o no", () => {
    expect(leerVeredicto('{"verdict": "CONFIRMED", "evidence": "line 12: <h1>"}')).toEqual({
      veredicto: "CONFIRMED",
      evidencia: "line 12: <h1>",
    });
    expect(leerVeredicto('{"verdict": "plausible", "evidence": "x"}')?.veredicto).toBe("PLAUSIBLE");
    expect(leerVeredicto('{"verdict": " Refuted ", "evidence": "x"}')?.veredicto).toBe("REFUTED");
  });

  it("con CSS citado DELANTE del JSON, que el corte ingenuo juntaba", () => {
    const raw = 'The rule `.hero { color: red }` is still there.\n{"verdict": "REFUTED", "evidence": ".hero { color: red }"}';
    expect(leerVeredicto(raw)).toEqual({ veredicto: "REFUTED", evidencia: ".hero { color: red }" });
  });

  it("sin evidencia, la evidencia es vacía pero el voto vale", () => {
    expect(leerVeredicto('{"verdict": "PLAUSIBLE"}')).toEqual({ veredicto: "PLAUSIBLE", evidencia: "" });
  });

  it("🔴 un voto que no es de los tres, o que no se entiende, es `null`", () => {
    expect(leerVeredicto('{"verdict": "MAYBE"}')).toBeNull();
    expect(leerVeredicto('{"evidence": "x"}')).toBeNull();
    expect(leerVeredicto("CONFIRMED")).toBeNull();
    expect(leerVeredicto('{"verdict": ')).toBeNull();
  });
});
