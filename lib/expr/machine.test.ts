import { describe, expect, it } from "vitest";

import { compile } from "./compile";
import { evaluate, type Env } from "./evaluate";
import { MACHINE_BYTES, MACHINE_JS } from "./machine";
import { parseExpression } from "./parse";
import { BOUND_NAME, type Node, type Value } from "./types";

function ast(src: string): Node {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(`no parseó "${src}": ${r.error.message}`);
  return r.node;
}

/**
 * Corre el MISMO texto que se hornea. Un runtime probado desde una copia
 * paralela es un runtime sin probar — y `new Function` aquí es el único sitio
 * legítimo, igual que en `recipes/test-helpers.ts::mount()`.
 */
const olX = new Function(`${MACHINE_JS}; return olX;`)() as (
  program: readonly unknown[],
  values: Record<string, Value>,
  random?: () => number,
) => Value;

const both = (src: string, env: Env = {}, rnd: () => number = () => 0.5) => ({
  servidor: evaluate(ast(src), env, rnd),
  navegador: olX([...compile(ast(src))], env as Record<string, Value>, rnd),
});

describe("el peso — el número que decide el techo", () => {
  /**
   * MEDIDO, no estimado. El plan apuntaba a ≤1,200 B y la realidad fueron 2,220:
   * la estimación se quedó corta casi a la mitad, y el número que manda es éste.
   *
   * 2,220 → 2,667 (L3): ELEMENTO, POSICION y las cuatro comprensiones acotadas.
   * 447 bytes por la diferencia entre "una calculadora" y "cualquier cosa que
   * se pueda preguntar sobre una lista".
   *
   * Lo que compra: 19 de las 20 formas de petición de la tabla, de UNA
   * implementación. La alternativa —recetas sueltas de calculadora, sorteo,
   * quiz e interruptor— serían 4 × 700 = 2,800 B **y seguirían sin cubrir lo que
   * nadie ha pedido todavía**. Sale más barato y llega más lejos.
   *
   * Y no lo paga ninguna página que no calcule: `present()` (build.ts:29) sólo
   * compone las recetas cuyo marcador está de verdad en el documento.
   *
   * El techo de aquí NO es un objetivo, es un detector de crecimiento
   * silencioso: si alguien añade una función al catálogo y esto sube, se ve.
   */
  it("no crece en silencio", () => {
    // eslint-disable-next-line no-console
    console.log(`\n  máquina de pila: ${MACHINE_BYTES} bytes\n`);
    expect(MACHINE_BYTES).toBeLessThanOrEqual(2800);
  });
});

// LA prueba de la etapa. Dos implementaciones que se separan en silencio es la
// clase de fallo que este repo ya pagó con la telemetría de conductas.
describe("los dos evaluadores dan lo MISMO", () => {
  const CASOS: Array<[string, Env]> = [
    // las 19 formas de la tabla del plan
    ["REDONDEA(recibo * 0.72, 0)", { recibo: 1800 }],
    ["base + peso * tarifa", { base: 90, peso: 3.5, tarifa: 22 }],
    ["metros * precio_m2", { metros: 48, precio_m2: 7800 }],
    ["REDONDEA(monto / meses, 2)", { monto: 24000, meses: 18 }],
    ["REDONDEA(cuenta * 1.15 / personas, 2)", { cuenta: 860, personas: 4 }],
    ["SUMA(p1, p2, p3)", { p1: 1, p2: 0, p3: 1 }],
    ["SI(puntaje > 7, 'Explorador', 'Guardián')", { puntaje: 9 }],
    ["precio_base + extra_talla", { precio_base: 499, extra_talla: 80 }],
    ["SI(anual, precio * 10, precio)", { anual: true, precio: 199 }],
    ["REDONDEA(kg / (m * m), 1)", { kg: 72, m: 1.75 }],
    ["MIN(100, ahorro / meta * 100)", { ahorro: 3000, meta: 12000 }],
    ["invitados * costo_plato", { invitados: 120, costo_plato: 340 }],
    ["REDONDEA(usd * tasa, 2)", { usd: 250, tasa: 18.4 }],
    ["SUMA(masa, ingredientes)", { masa: 120, ingredientes: [35, 35, 20] }],
    ["SI(votos_si > votos_no, 'Sí gana', 'No gana')", { votos_si: 12, votos_no: 4 }],
    ["puntaje >= 8", { puntaje: 8 }],
    ["voto != ''", { voto: "" }],
    ["voto != ''", { voto: "si" }],
    ["a != b", { a: 3, b: 3 }],
    ["a != b", { a: 3, b: 4 }],
    ["NO (a != b)", { a: 1, b: 2 }],
    ["elegido = 'pro'", { elegido: "pro" }],
    ["dia = 'sabado'", { dia: "sabado" }],
    ["MONEDA(total, 2)", { total: 40800 }],

    // y las esquinas donde dos implementaciones se separan de verdad
    ["5 / 0", {}],
    ["7 % 0", {}],
    ["nadie * 2", {}],
    ["monto * 1", { monto: "$1,200.50" }],
    ["edad = 10", { edad: "10" }],
    ["NO 1 > 2", {}],
    ["1 > 2 O 3 > 2", {}],
    ["1 > 2 Y 3 > 2", {}],
    ["2 > 1 Y 3 > 2", {}],
    ["-3 + 5", {}],
    ["2 + 3 * 4", {}],
    ["(2 + 3) * 4", {}],
    ["MAX(4, 2, 9)", {}],
    ["MIN(precios)", { precios: [9, 4, 7] }],
    ["CUENTA(precios)", { precios: [9, 4, 7] }],
    ["UNE('Ahorras ', MONEDA(x, 2), ' al mes')", { x: 1234.5 }],
    ["TEXTO(activo)", { activo: true }],
    ["SUMA(1, 2, 3) + MAX(1, 2)", {}],
    ["SI(a > b, SI(a > c, 'a', 'c'), SI(b > c, 'b', 'c'))", { a: 3, b: 9, c: 5 }],

    // ── L3: listas por posición ──────────────────────────────────────────
    ["ELEMENTO(l, 1)", { l: ["a", "b", "c"] }],
    ["ELEMENTO(l, 3)", { l: ["a", "b", "c"] }],
    ["ELEMENTO(l, 0)", { l: ["a", "b", "c"] }],
    ["ELEMENTO(l, 9)", { l: ["a", "b", "c"] }],
    ["ELEMENTO(l, i)", { l: [10, 20, 30], i: "2" }],
    ["ELEMENTO(x, 1)", { x: 7 }],
    ["POSICION(l, 'b')", { l: ["a", "b", "c"] }],
    ["POSICION(l, 'z')", { l: ["a", "b", "c"] }],
    ["POSICION(l, 20)", { l: ["10", "20"] }],
    // Listas PARALELAS — el carrito sin objetos ni propiedades.
    ["ELEMENTO(precios, POSICION(nombres, elegido))", { nombres: ["café", "té"], precios: [50, 40], elegido: "té" }],

    // ── L3: comprensiones acotadas ───────────────────────────────────────
    ["TODOS(p, CADA > 100)", { p: [200, 300] }],
    ["TODOS(p, CADA > 100)", { p: [200, 50] }],
    ["TODOS(p, CADA > 100)", { p: [] }],
    ["ALGUNO(p, CADA > 100)", { p: [50, 200] }],
    ["ALGUNO(p, CADA > 100)", { p: [] }],
    ["CUENTA_SI(r, CADA = 'sí')", { r: ["sí", "no", "sí"] }],
    ["FILTRA(p, CADA > 100)", { p: [50, 200, 300] }],
    ["SUMA(FILTRA(p, CADA > 100))", { p: [50, 200, 300] }],
    ["CUENTA(FILTRA(p, CADA > 100))", { p: [50, 200, 300] }],
    ["ALGUNO(l, CADA = yo)", { l: ["ana", "beto"], yo: "beto" }],
    // El elemento en curso convive con los nombres de fuera.
    ["CUENTA_SI(p, CADA > tope)", { p: [10, 50, 90], tope: 40 }],
    // Anidada: la de dentro no le pisa el elemento a la de fuera.
    ["ALGUNO(a, TODOS(b, CADA > 1) Y CADA > 0)", { a: [1], b: [2, 3] }],
    // Una comprensión sobre algo que NO es lista lo trata como lista de uno.
    ["TODOS(x, CADA > 1)", { x: 5 }],

    // ── listas escritas a mano — el hueco que el modelo intentó llenar solo ──
    ["CUENTA_SI([45,50,52,58,60,68,55,62], CADA < 60)", {}],
    ["SUMA([1, 2, 3])", {}],
    ["CUENTA([])", {}],
    ["ELEMENTO(['a','b','c'], 2)", {}],
    ["POSICION([10, 20, 30], 20)", {}],
    ["TODOS([2, 4], CADA > 1)", {}],
    ["SUMA(FILTRA([10, 200, 30], CADA > 50))", {}],
    ["[precio, precio * 2]", { precio: 5 }],
    ["MAX([a, b, 7])", { a: 3, b: 9 }],
    ["TEXTO([1, 'dos', cierto])", { cierto: true }],
    // Anidada, y con una comprensión que la recorre.
    ["CUENTA([[1,2],[3]])", {}],
    ["AZAR([7])", {}],
  ];

  it.each(CASOS)("%s", (src, env) => {
    const r = both(src, env);
    expect(r.navegador).toEqual(r.servidor);
  });

  // Con SI compilado como llamada de tres argumentos, la rama perdedora
  // consumiría un número aleatorio y los dos evaluadores divergirían. Por eso
  // se compila a SALTOS.
  it("SI no gasta azar en la rama que pierde", () => {
    let servidorLlamadas = 0;
    let navegadorLlamadas = 0;
    const src = "SI(mostrar, AZAR(1, 100), 0)";
    evaluate(ast(src), { mostrar: false }, () => { servidorLlamadas += 1; return 0.5; });
    olX([...compile(ast(src))], { mostrar: false }, () => { navegadorLlamadas += 1; return 0.5; });
    expect(navegadorLlamadas).toBe(servidorLlamadas);
    expect(navegadorLlamadas).toBe(0);
  });

  it("Y y O tampoco evalúan el lado que no hace falta", () => {
    let n = 0;
    const rnd = () => { n += 1; return 0.5; };
    olX([...compile(ast("falso Y AZAR(1, 9) > 0"))], { falso: false }, rnd);
    expect(n).toBe(0);
    olX([...compile(ast("cierto O AZAR(1, 9) > 0"))], { cierto: true }, rnd);
    expect(n).toBe(0);
  });

  it("el azar coincide cuando SÍ se usa", () => {
    const r = both("AZAR(nombres)", { nombres: ["ana", "beto", "cleo"] }, () => 0.5);
    expect(r.navegador).toBe("beto");
    expect(r.navegador).toBe(r.servidor);
  });
});

/**
 * LA prueba estructural, y existe porque esta familia de bug ya se pagó DOS
 * veces: la máquina decide con `charAt(0)`, así que cualquier sigilo de una
 * letra que sea PREFIJO de un operador se lo come antes de llegar al bloque de
 * operadores binarios.
 *
 *   1ª vez — el sigilo de salto era ">", y se comía ">" y ">=".
 *   2ª vez — el sigilo de negación era "!", y se comía "!=". Nadie lo vio
 *            porque ningún caso de acuerdo de arriba usaba "!=", pese a que el
 *            operador SÍ está en el contrato que el prompt le enseña al modelo.
 *
 * Un caso más en la lista de arriba habría cazado el segundo. Esto caza a toda
 * la familia, incluida la 3ª vez.
 */
describe("ningún sigilo puede ser prefijo de un operador", () => {
  const OPERADORES = ["+", "-", "*", "/", "%", "=", "!=", "<", "<=", ">", ">=", "Y", "O"];
  // Los sigilos que la máquina reconoce por su primera letra, leídos del
  // propio texto que se hornea — no de una lista escrita a mano que pueda
  // quedarse vieja.
  const sigilos = [...MACHINE_JS.matchAll(/k=="(.)"/g)].map((m) => m[1]!);

  it("se leen del texto de la máquina, y hay varios", () => {
    expect(sigilos.length).toBeGreaterThan(5);
  });

  it.each(OPERADORES)("%s no empieza por un sigilo", (op) => {
    expect(
      sigilos,
      `el operador "${op}" empieza por "${op[0]}", que la máquina trata como sigilo — ` +
        `charAt(0) lo desvía antes de llegar al bloque de operadores binarios`,
    ).not.toContain(op[0]);
  });
});

describe("el programa compilado", () => {
  it("es plano y JSON-serializable — viaja en un atributo", () => {
    const p = compile(ast("REDONDEA(recibo * 0.72, 0)"));
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(p.every((x) => ["string", "number", "boolean"].includes(typeof x))).toBe(true);
  });

  it("compacto: una fórmula real no infla el HTML", () => {
    const json = JSON.stringify(compile(ast("REDONDEA(recibo * 0.72, 0)")));
    expect(json).toBe('["$recibo",0.72,"*",0,"@REDONDEA:2"]');
  });

  it("SI se compila a saltos, no a una llamada", () => {
    const p = compile(ast("SI(a, 1, 2)"));
    expect(p.some((x) => typeof x === "string" && x.startsWith("?"))).toBe(true);
    expect(p.some((x) => typeof x === "string" && x.startsWith("@SI"))).toBe(false);
  });
});

describe("el nombre ligado vive en DOS sitios y no pueden separarse", () => {
  // `BOUND_NAME` gobierna el compilador y el evaluador del servidor; la máquina
  // lo lleva escrito literal (`V.CADA`) porque ahí no hay imports. Si alguien
  // renombra la constante y no el texto, las comprensiones dejarían de ligar
  // nada EN EL NAVEGADOR y en el servidor seguirían funcionando: la divergencia
  // silenciosa de siempre, esta vez sin que ningún caso de acuerdo la note
  // (todos pasarían — el servidor decide el valor esperado).
  it("la máquina liga exactamente BOUND_NAME", () => {
    expect(MACHINE_JS).toContain(`V.${BOUND_NAME}`);
  });
});

describe("el sub-programa de una comprensión", () => {
  it("va anidado, y el todo sigue siendo JSON que da la vuelta idéntico", () => {
    const p = compile(ast("TODOS(precios, CADA > 100)"));
    expect(p).toEqual(["$precios", ["$CADA", 100, ">"], "@TODOS:2"]);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  // Si se compilara en línea, la condición se evaluaría UNA vez con CADA sin
  // ligar — o sea, nunca. Que el 2º argumento sea un array es el contrato.
  it("NO se compila en línea", () => {
    const p = compile(ast("ALGUNO(l, CADA = 'x')"));
    expect(Array.isArray(p[1])).toBe(true);
  });
});
