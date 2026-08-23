import { describe, expect, it } from "vitest";

import {
  MAX_PASOS,
  avisoSpec,
  leerFallos,
  parseBehaviorSpec,
  specProgram,
  specRechazoAviso,
} from "./behavior-spec";

const RULETA = [{ clic: "#girar", entonces: [{ donde: "#resultado", que: "cambia" }] }];

describe("lo que el modelo puede prometer", () => {
  it("acepta la promesa de una ruleta", () => {
    const r = parseBehaviorSpec(RULETA);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos[0]!.clic).toBe("#girar");
    expect(r.pasos[0]!.veces).toBe(1);
  });

  it("acepta un carrito: tres clics y un total exacto", () => {
    const r = parseBehaviorSpec([
      { clic: "#add", veces: 3, entonces: [{ donde: "#total", que: "es", valor: "3" }] },
    ]);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos[0]!.veces).toBe(3);
  });

  it("acepta una calculadora: escribe y luego comprueba", () => {
    const r = parseBehaviorSpec([
      {
        escribe: { "#precio": "100" },
        clic: "#calcular",
        entonces: [{ donde: "#iva", que: "contiene", valor: "16" }],
      },
    ]);
    expect(r.kind).toBe("spec");
  });

  it("sin prueba no hay error — es opcional", () => {
    expect(parseBehaviorSpec(undefined).kind).toBe("ninguna");
    expect(parseBehaviorSpec(null).kind).toBe("ninguna");
  });
});

describe("lo que NO se acepta, y por qué", () => {
  // Mirar un elemento quieto no comprueba una promesa de COMPORTAMIENTO —
  // comprueba el HTML. Pero eso vale para el PRIMER paso.
  it("el PRIMER paso sin acción no prueba nada", () => {
    const r = parseBehaviorSpec([{ entonces: [{ donde: "#x", que: "visible" }] }]);
    expect(r).toEqual({ kind: "error", reason: "sin_accion" });
  });

  // MEDIDO: el modelo escribe un paso que sólo mira DESPUÉS de uno que actúa
  // («…y además el resultado contiene "¡"»). Es una comprobación adicional
  // sobre el estado que dejó el anterior, y rechazarla tiraba 2 de cada 4
  // pruebas bien intencionadas.
  it("un paso posterior SÍ puede sólo comprobar", () => {
    const r = parseBehaviorSpec([
      { clic: "#girar", entonces: [{ donde: "#resultado", que: "cambia" }] },
      { entonces: [{ donde: "#resultado", que: "contiene", valor: "¡" }] },
    ]);
    expect(r.kind).toBe("spec");
    if (r.kind !== "spec") return;
    expect(r.pasos).toHaveLength(2);
    expect(r.pasos[1]!.clic).toBeUndefined();
  });

  it("un paso sin expectativa tampoco", () => {
    expect(parseBehaviorSpec([{ clic: "#girar", entonces: [] }])).toEqual({
      kind: "error",
      reason: "sin_expectativa",
    });
  });

  it("«contiene» sin con qué comparar se rechaza", () => {
    const r = parseBehaviorSpec([
      { clic: "#a", entonces: [{ donde: "#b", que: "contiene" }] },
    ]);
    expect(r).toEqual({ kind: "error", reason: "falta_valor" });
  });

  // Un selector que casa con varios elementos hace la prueba ambigua, y una
  // prueba ambigua MIENTE — dice que pasó sobre un elemento que no era.
  it("un selector ambiguo o raro se rechaza", () => {
    for (const sel of ["#a, #b", "div:has(> p)", "*", "#a'); alert(1)//"]) {
      expect(parseBehaviorSpec([{ clic: sel, entonces: [{ donde: "#r", que: "cambia" }] }]).kind, sel)
        .toBe("error");
    }
  });

  // Rechazo ENTERO, nunca a medias: probar la mitad de la promesa y decir que
  // pasó es peor que no probar.
  it("un paso malo tumba la tanda entera", () => {
    const r = parseBehaviorSpec([
      { clic: "#bueno", entonces: [{ donde: "#r", que: "cambia" }] },
      { clic: "#a, #b", entonces: [{ donde: "#r", que: "cambia" }] },
    ]);
    expect(r.kind).toBe("error");
  });

  it("se acota el número de pasos y de clics", () => {
    const muchos = Array.from({ length: MAX_PASOS + 1 }, () => RULETA[0]);
    expect(parseBehaviorSpec(muchos)).toEqual({ kind: "error", reason: "demasiados_pasos" });
    // 999 clics es un bucle disfrazado — se recorta, no se rechaza.
    const r = parseBehaviorSpec([{ clic: "#a", veces: 999, entonces: [{ donde: "#r", que: "cambia" }] }]);
    expect(r.kind === "spec" && r.pasos[0]!.veces).toBe(10);
  });
});

describe("el programa que corre en el navegador", () => {
  // La trampa que costó una sesión: page.evaluate(() => …) pasa por esbuild,
  // que inyecta el ayudante `__name`, y `__name` no existe en el navegador.
  it("no lleva funciones NOMBRADAS (el ayudante __name no existe en Chrome)", () => {
    const p = specProgram(parseBehaviorSpec(RULETA).kind === "spec" ? RULETA as never : []);
    expect(p).not.toMatch(/function\s+[A-Za-z_$]/);
    expect(p).not.toContain("__name");
  });

  it("los pasos viajan como JSON, no interpolados en el código", () => {
    const p = specProgram([
      { clic: "#a", veces: 1, entonces: [{ donde: "#r", que: "es", valor: '");alert(1)//' }] },
    ]);
    // El valor hostil vive dentro de una cadena JSON, no como código suelto.
    expect(p).toContain("JSON.parse");
    expect(p).not.toMatch(/\);alert\(1\)\/\/"\s*[;)]/);
  });
});

describe("lo que devuelve el navegador", () => {
  it("se leen los fallos y el paso se cuenta desde 1 (como lo lee un humano)", () => {
    expect(leerFallos([[0, "#total no cambió"]])).toEqual([{ paso: 1, mensaje: "#total no cambió" }]);
  });

  // No medir NO es medir mal: cualquier forma inesperada se descarta en vez de
  // inventar un fallo.
  it("una respuesta rara no acusa a la página", () => {
    expect(leerFallos(null)).toEqual([]);
    expect(leerFallos("boom")).toEqual([]);
    expect(leerFallos([{ nope: 1 }])).toEqual([]);
  });
});

describe("los avisos", () => {
  it("el del modelo nombra el paso, el elemento, y le prohíbe cantar victoria", () => {
    const a = avisoSpec([{ paso: 1, mensaje: "#resultado no cambió" }]);
    expect(a).toContain("#resultado");
    expect(a).toMatch(/NO le digas al usuario que funciona/);
    // Y le dice que NO es sintaxis, o buscará el bug donde no está.
    expect(a).toMatch(/NO es un fallo de sintaxis/);
  });

  it("el del usuario dice que su cambio SÍ se guardó", () => {
    expect(specRechazoAviso("sin_accion")).toContain("El cambio sí se guardó");
  });
});
