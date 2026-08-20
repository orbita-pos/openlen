import { describe, expect, it } from "vitest";

import { parseAssignment, parseExpression, referencedNames } from "./parse";
import { evaluate, type Env } from "./evaluate";
import type { Node } from "./types";

function ast(src: string): Node {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(`no parseó "${src}": ${r.error.message}`);
  return r.node;
}
const run = (src: string, env: Env = {}, rnd?: () => number) => evaluate(ast(src), env, rnd);
const fails = (src: string) => {
  const r = parseExpression(src);
  return r.ok ? null : r.error.message;
};

describe("lo que el lenguaje NO sabe leer", () => {
  // Esto no es una lista de prohibiciones: es que no hay sintaxis para
  // escribirlo. Un bucle no se rechaza — no existe.
  it.each([
    ["un bucle", "for (i = 0; i < 10; i++) x"],
    ["definir una función", "function f() { return 1 }"],
    ["una flecha", "() => 1"],
    ["alcanzar el navegador", "window.location"],
    ["alcanzar el documento", "document.cookie"],
    ["una función que no está en el catálogo", "FETCH('http://x')"],
    ["eval por su nombre", "eval('1')"],
    ["un constructor", "new Date()"],
    ["indexar", "lista[0]"],
    ["un punto y coma", "1; 2"],
  ])("%s no parsea", (_nombre, src) => {
    expect(fails(src), src).toBeTruthy();
  });

  it("una fórmula desmedidamente larga se rechaza en vez de colgar la puerta", () => {
    expect(fails("1" + "+1".repeat(200))).toMatch(/demasiado larga/);
  });

  it("un paréntesis sin cerrar da un mensaje, no una excepción", () => {
    expect(fails("SUMA(1, 2")).toMatch(/cerrar/);
  });

  it("el mensaje señala DÓNDE — el modelo tiene que poder corregirse", () => {
    const r = parseExpression("1 + @");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.at).toBe(4);
  });
});

describe("aritmética y precedencia", () => {
  it.each([
    ["2 + 3 * 4", 14],
    ["(2 + 3) * 4", 20],
    ["10 / 4", 2.5],
    ["-3 + 5", 2],
    ["7 % 3", 1],
  ])("%s = %s", (src, want) => expect(run(src)).toBe(want));

  // En la página de alguien, "Infinity" es un defecto visible.
  it("dividir entre cero da 0, no Infinity", () => {
    expect(run("5 / 0")).toBe(0);
  });
});

describe("los valores del visitante", () => {
  it("un nombre lee del entorno", () => {
    expect(run("recibo * 0.7", { recibo: 1200 })).toBe(840);
  });

  // Un campo vacío es lo normal al cargar la página, no un error.
  it("un nombre que no existe vale 0", () => {
    expect(run("recibo * 2")).toBe(0);
  });

  it("un número escrito como lo escribe una persona se entiende", () => {
    expect(run("monto * 1", { monto: "$1,200.50" })).toBe(1200.5);
  });

  it("referencedNames encuentra lo que la fórmula LEE", () => {
    expect([...referencedNames(ast("SI(a > b, a * c, 0)"))].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("las funciones de tarea", () => {
  it.each([
    ["SUMA(1, 2, 3)", 6],
    ["MIN(4, 2, 9)", 2],
    ["MAX(4, 2, 9)", 9],
    ["REDONDEA(2.567, 2)", 2.57],
    ["REDONDEA(2.5)", 3],
    ["SI(3 > 2, 10, 20)", 10],
    ["SI(3 < 2, 10, 20)", 20],
  ])("%s = %s", (src, want) => expect(run(src)).toBe(want));

  it("MONEDA da un texto estable, igual en servidor y navegador", () => {
    expect(run("MONEDA(1234567.891, 2)")).toBe("1,234,567.89");
  });

  it("SI no evalúa la rama que pierde", () => {
    // Sin pereza, esto dividiría entre cero antes de elegir.
    expect(run("SI(d = 0, 0, 100 / d)", { d: 0 })).toBe(0);
  });

  it("SUMA aplana una lista — quien escribe no distingue", () => {
    expect(run("SUMA(precios)", { precios: [10, 20, 30] })).toBe(60);
    expect(run("CUENTA(precios)", { precios: [10, 20, 30] })).toBe(3);
  });
});

describe("el azar, con la fuente inyectada para poder probarlo", () => {
  it("AZAR(lista) elige un elemento", () => {
    expect(run("AZAR(nombres)", { nombres: ["ana", "beto", "cleo"] }, () => 0.5)).toBe("beto");
  });

  it("AZAR(lista vacía) no revienta", () => {
    expect(run("AZAR(nombres)", { nombres: [] }, () => 0.5)).toBe(0);
  });

  it("AZAR(a, b) da un entero dentro del rango, extremos incluidos", () => {
    expect(run("AZAR(1, 6)", {}, () => 0)).toBe(1);
    expect(run("AZAR(1, 6)", {}, () => 0.999)).toBe(6);
  });
});

describe("comparación y lógica", () => {
  it.each([
    ["3 = 3", true],
    ["3 != 4", true],
    ["2 <= 2", true],
    ["1 > 2 O 3 > 2", true],
    ["1 > 2 Y 3 > 2", false],
    ["NO 1 > 2", true],
  ])("%s = %s", (src, want) => expect(run(src)).toBe(want));

  // El visitante que teclea "10" no distingue el número del texto.
  it("compara tipos distintos como texto", () => {
    expect(run("edad = 10", { edad: "10" })).toBe(true);
  });
});

describe("asignación — la forma de data-ol-set", () => {
  it("separa el destino de la expresión", () => {
    const r = parseAssignment("elegido = AZAR(nombres)");
    expect(r.ok && r.node.target).toBe("elegido");
    expect(r.ok && evaluate(r.node.value, { nombres: ["x"] }, () => 0)).toBe("x");
  });

  it("un destino que no es un nombre se rechaza", () => {
    const r = parseAssignment("2 + 2 = 5");
    expect(r.ok).toBe(false);
  });

  it("sin = no es una asignación", () => {
    expect(parseAssignment("AZAR(nombres)").ok).toBe(false);
  });

  it("el error de la expresión señala su posición REAL en la cadena completa", () => {
    const r = parseAssignment("x = 1 + @");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.at).toBe(8);
  });
});

// La prueba que decide si el diseño sirve. Diecisiete de estos casos se
// escribieron ANTES de existir el lenguaje, en el plan, para que no pudiera
// hacerse a su medida.
describe("las 19 formas de la tabla del plan", () => {
  const CASOS: Array<[string, string, Env, unknown]> = [
    ["paneles solares", "REDONDEA(recibo * 0.72, 0)", { recibo: 1800 }, 1296],
    ["envío por peso y zona", "base + peso * tarifa", { base: 90, peso: 3.5, tarifa: 22 }, 167],
    ["obra por m²", "metros * precio_m2", { metros: 48, precio_m2: 7800 }, 374400],
    ["mensualidad", "REDONDEA(monto / meses, 2)", { monto: 24000, meses: 18 }, 1333.33],
    ["propina dividida", "REDONDEA(cuenta * 1.15 / personas, 2)", { cuenta: 860, personas: 4 }, 247.25],
    ["quiz con puntaje", "SUMA(p1, p2, p3)", { p1: 1, p2: 0, p3: 1 }, 2],
    ["test de personalidad", "SI(puntaje > 7, 'Explorador', 'Guardián')", { puntaje: 9 }, "Explorador"],
    ["configurador", "precio_base + extra_talla", { precio_base: 499, extra_talla: 80 }, 579],
    ["mensual vs anual", "SI(anual, precio * 10, precio)", { anual: true, precio: 199 }, 1990],
    ["IMC", "REDONDEA(kg / (m * m), 1)", { kg: 72, m: 1.75 }, 23.5],
    ["barra que crece", "MIN(100, ahorro / meta * 100)", { ahorro: 3000, meta: 12000 }, 25],
    ["banquete", "invitados * costo_plato", { invitados: 120, costo_plato: 340 }, 40800],
    ["divisas", "REDONDEA(usd * tasa, 2)", { usd: 250, tasa: 18.4 }, 4600],
    ["arma tu pizza", "SUMA(masa, ingredientes)", { masa: 120, ingredientes: [35, 35, 20] }, 210],
    ["encuesta", "SI(votos_si > votos_no, 'Sí gana', 'No gana')", { votos_si: 12, votos_no: 4 }, "Sí gana"],
    ["mostrar-si", "puntaje >= 8", { puntaje: 8 }, true],
    ["comparador resalta", "elegido = 'pro'", { elegido: "pro" }, true],
    ["horario según día", "dia = 'sabado'", { dia: "sabado" }, true],
    ["moneda con miles", "MONEDA(total, 2)", { total: 40800 }, "40,800.00"],
  ];

  it.each(CASOS)("%s", (_nombre, src, env, want) => {
    expect(run(src, env)).toBe(want);
  });

  it("la ruleta necesita azar, y por eso va aparte", () => {
    const r = parseAssignment("elegido = AZAR(nombres)");
    expect(r.ok).toBe(true);
    expect(r.ok && evaluate(r.node.value, { nombres: ["ana", "beto"] }, () => 0.9)).toBe("beto");
  });
});
