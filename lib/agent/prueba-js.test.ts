// LO PURO DE LA PRUEBA DECLARADA: la entrada, lo que devuelve el navegador y la
// nota de sus fallos. Lo que corre DENTRO del navegador se prueba en
// `prueba-js.browser.test.ts`, que es el único sitio donde se puede.
//
// Parte de esto se portó de `behavior-spec.test.ts` al retirar el DSL
// (2026-09-22): `leerFallos` y `notaSpec` sobrevivieron al DSL, y sus pruebas
// tenían que sobrevivir con ellas.
import { describe, expect, it } from "vitest";

import {
  leerFallos,
  leerSinCorrer,
  leerVacuas,
  notaSpec,
  pareceJs,
  programaJs,
  programaSinAccionesJs,
  TOPE_MENSAJE,
  validaPruebaJs,
} from "./prueba-js";

describe("la entrada", () => {
  // La forma del contenido decide: la lista de pasos del DSL retirado se
  // reconoce para poder RECHAZARLA con su nombre, no para ejecutarla.
  it("la lista de pasos del DSL se reconoce por su forma, y un programa es JS", () => {
    expect(pareceJs('[{"clic":"#a","entonces":[]}]')).toBe(false);
    expect(pareceJs('{"clic":"#a"}')).toBe(false);
    expect(pareceJs('await ui.clic("#a");')).toBe(true);
    expect(pareceJs("   ")).toBe(false);
  });

  it("la validación de entrada es de TAMAÑO, no de sintaxis", () => {
    expect(validaPruebaJs("await ui.clic('#a');").ok).toBe(true);
    // Un programa que no compila PASA la entrada: lo dice Chromium, como fallo
    // de la prueba, en vez de deducirlo aquí con otro parser.
    expect(validaPruebaJs("await ui.clic(  ;;;").ok).toBe(true);
    expect(validaPruebaJs("   ")).toEqual({ ok: false, reason: "vacia" });
    expect(validaPruebaJs("x".repeat(5000))).toEqual({ ok: false, reason: "demasiado_grande" });
  });
});

describe("el programa que corre en el navegador", () => {
  // El código del modelo viaja como DATO dentro de un literal JSON y se compila
  // allí con `new Function`: interpolado tal cual, un error de sintaxis del
  // modelo tumbaría el programa entero y un texto hostil sería código suelto.
  it("el código del modelo va dentro de un literal JSON, no interpolado", () => {
    const hostil = '");alert(1)//';
    const p = programaJs(hostil);
    expect(p).toContain(`var PROGRAMAS = ${JSON.stringify([{ codigo: hostil, propia: true }])};`);
    expect(p).toContain('new Function("ui"');
  });

  // Va como CADENA porque una función pasaría por esbuild, que inyecta
  // `__name`, y `__name` no existe en el navegador.
  it("no lleva el ayudante __name que inyecta el transpilador", () => {
    expect(programaJs('await ui.clic("#a");')).not.toContain("__name");
  });
});

describe("lo que devuelve el navegador", () => {
  it("se leen los fallos y el paso se cuenta desde 1, como lo lee una persona", () => {
    expect(leerFallos([[0, "#total no cambió"]])).toEqual([{ paso: 1, mensaje: "#total no cambió" }]);
  });

  // No medir NO es medir mal: una forma inesperada se descarta en vez de
  // inventar un fallo.
  it("una respuesta rara no acusa a la página", () => {
    expect(leerFallos(null)).toEqual([]);
    expect(leerFallos("boom")).toEqual([]);
    expect(leerFallos([{ nope: 1 }])).toEqual([]);
  });

  it("la marca `prueba` separa el instrumento de la página, y dice de qué programa es", () => {
    expect(leerFallos([[2, ".x señala 3 elementos, no uno", "prueba", 1]])).toEqual([
      { paso: 3, mensaje: ".x señala 3 elementos, no uno", deLaPrueba: true, programa: 1 },
    ]);
  });

  // Lo que se quedó sin tiempo NO es un fallo ni una promesa cumplida: va por
  // su propio canal, o una guardada rota se contaría como arreglada.
  it("lo que no llegó a correr no es un fallo: va por su canal", () => {
    const bruto = [
      [0, "sin tiempo para correrla", "sin_correr", 2],
      [0, "#a no cambió", null, 0],
    ];
    expect(leerFallos(bruto)).toEqual([{ paso: 1, mensaje: "#a no cambió", programa: 0 }]);
    expect(leerSinCorrer(bruto)).toEqual([2]);
    expect(leerSinCorrer("boom")).toEqual([]);
  });

  it("un mensaje enorme se acota", () => {
    expect(leerFallos([[0, "x".repeat(5000)]])[0]!.mensaje).toHaveLength(TOPE_MENSAJE);
  });

  // 🔴 LO QUE NO DISCRIMINA NO ES UN FALLO. Si `leerFallos` lo dejara pasar,
  // todo el que cuenta «lo que no es de la prueba» lo leería como la página que
  // no cumplió, y acusaría a una página sana por una promesa floja.
  it("lo que no discrimina va por su canal, nunca como fallo de la página", () => {
    const bruto = [
      [1, 'ui.contiene("#n", "5,000") se cumple también sin tus acciones', "vacua", 0],
      [0, "#a no cambió", null, 0],
    ];
    expect(leerFallos(bruto)).toEqual([{ paso: 1, mensaje: "#a no cambió", programa: 0 }]);
    expect(leerVacuas(bruto)).toEqual([
      { paso: 2, mensaje: 'ui.contiene("#n", "5,000") se cumple también sin tus acciones' },
    ]);
    expect(leerVacuas("boom")).toEqual([]);
  });
});

describe("el brazo sin acciones", () => {
  // Es la batería la que lo pide; el programa de un turno normal sale byte a
  // byte igual que antes de que existiera.
  it("se pide con su marca, y el programa normal no la lleva", () => {
    const codigo = 'await ui.clic("#b");';
    expect(programaSinAccionesJs(codigo)).toContain(
      `var PROGRAMAS = ${JSON.stringify([{ codigo, propia: true, sinAcciones: true }])};`,
    );
    expect(programaJs(codigo)).not.toContain("sinAcciones\":true");
  });
});

// 🔴 UN FALLO DEL INSTRUMENTO NO ACUSA AL SUJETO.
//
// MEDIDO en producción el 2026-09-21: de 40 turnos con verificación, 2 traían
// una prueba declarada fallida, y los 2 eran del instrumento —un selector que
// señalaba 10 elementos— pidiéndole al dueño que revisara una página sana. Con
// los 3 del 2026-09-04 van 0 de 5 aciertos acusando.
describe("notaSpec: un fallo DE LA PRUEBA no se cuenta como fallo de la página", () => {
  const delInstrumento = [
    { paso: 1, mensaje: "#carrusel .swiper-slide señala 10 elementos, no uno", deLaPrueba: true },
  ] as const;
  const deLaPagina = [{ paso: 1, mensaje: "#resultado no cambió" }] as const;

  it("del instrumento: no habla de la página y NO ofrece revisarla", () => {
    const n = notaSpec(delInstrumento);
    expect(n).toMatch(/no llegó a correr/);
    expect(n).toMatch(/no dice nada sobre la página/);
    expect(n).not.toMatch(/dime si quieres que lo revise/);
    // Y el hecho medido viaja igual: se dice lo que se vio.
    expect(n).toContain("señala 10 elementos, no uno");
  });

  it("de la página: dice que no se cumplió, que está guardado, y ofrece revisarlo", () => {
    const n = notaSpec(deLaPagina);
    expect(n).toMatch(/no se cumplió/);
    expect(n).toMatch(/El cambio está guardado/);
    expect(n).toMatch(/dime si quieres que lo revise/);
  });

  it("mezclados: cada mitad se atribuye a quien es", () => {
    const n = notaSpec([...deLaPagina, ...delInstrumento]);
    expect(n).toMatch(/no se cumplió/);
    expect(n).toMatch(/falló en mi comprobación, no en la página/);
    // El fallo real no se diluye: la página sigue señalada.
    expect(n).toContain("#resultado no cambió");
  });
});
