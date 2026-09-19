// @vitest-environment node
//
// LA SUITE DE LA PÁGINA, EN UN NAVEGADOR DE VERDAD.
//
// 🔴 POR QUÉ ESTA PRUEBA Y NO MÁS UNITARIAS. Las otras 37 del módulo comprueban
// mis arrays a mano: que `repartirFallos` reparte, que `vivas` filtra. Lo que
// NINGUNA podía decir es si el programa que se le manda a Chromium con la
// promesa del turno MÁS las guardadas corre de verdad, y si lo que vuelve —que
// lo escribe el navegador, no yo— se reparte a quien toca.
//
// MEDIDO aquí por primera vez el 2026-09-18 de madrugada: con el manejador de
// `#agregar` quitado, el navegador devolvió «#total no cambió (sigue diciendo
// "0 €")» y esa frase llegó a `regresiones` con el id de la promesa. Antes de
// esta prueba, toda la suite estaba verde sin haber corrido nunca.
//
// La VISIÓN va simulada a propósito: lo que se mide es el navegador y el
// reparto, no al crítico — y una prueba que llama al modelo cuesta dinero y
// falla los días que la red va mal.
import { describe, expect, it } from "vitest";

import { verifyEditedPage } from "./verify";
import type { PruebaGuardada } from "./pruebas-de-la-pagina";

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Taller</title></head>
<body>
  <h1>Mesa de comedor</h1>
  <button id="agregar" type="button">Añadir</button>
  <b id="total">0 €</b>
  <button id="vaciar" type="button">Vaciar</button>
</body></html>`;

/** El carrito que el turno 3 construyó y comprobó. */
const RUNTIME_BUENO = `
  var n = 0;
  document.getElementById("agregar").addEventListener("click", function () {
    n += 1; document.getElementById("total").textContent = (n * 2480) + " €";
  });
  document.getElementById("vaciar").addEventListener("click", function () {
    n = 0; document.getElementById("total").textContent = "0 €";
  });
`;

/** El turno 9: reescribe el runtime entero —como manda `editar_runtime`— y se
 *  deja por el camino el manejador de `#agregar`. La página no explota, la foto
 *  sale idéntica y la consola está limpia. */
const RUNTIME_ROTO = `
  document.getElementById("vaciar").addEventListener("click", function () {
    document.getElementById("total").textContent = "0 €";
  });
`;

const PROMESA: PruebaGuardada = {
  id: "p-carrito",
  pagina: null,
  creada: 1,
  pasos: [{ clic: "#agregar", entonces: [{ donde: "#total", que: "cambia" }] }],
};

const visionLimpia = {
  stream: () =>
    (async function* () {
      yield { type: "text_delta", text: '{"broken":false,"issues":[]}' };
      yield { type: "done", stopReason: { kind: "end_turn" } };
    })() as never,
};

const mirar = (runtime: string, guardadas: readonly PruebaGuardada[]) =>
  verifyEditedPage(
    { html: PAGINA, runtime, userPrompt: "ponme un carrito", guardadas },
    { provider: visionLimpia as never },
  );

describe("la suite de la página, en Chromium", () => {
  it("🔴 una promesa que se sigue cumpliendo no acusa a nadie", async () => {
    const v = await mirar(RUNTIME_BUENO, [PROMESA]);
    expect(v.fallback).toBe(false);
    expect(v.regresiones ?? []).toEqual([]);
    expect(v.retirarPruebas ?? []).toEqual([]);
  }, 120_000);

  it("🔴 el turno que rompe el carrito hace saltar la promesa, con su id", async () => {
    const v = await mirar(RUNTIME_ROTO, [PROMESA]);
    expect(v.fallback).toBe(false);
    expect(v.regresiones?.[0]?.id).toBe("p-carrito");
    // El mensaje lo escribe el NAVEGADOR: nombra el elemento y lo que vio.
    expect(v.regresiones?.[0]?.mensaje).toMatch(/#total/);
  }, 120_000);

  // 🔴 LA OTRA MITAD DEL CICLO DE VIDA, y la que evita el peor final: una
  // promesa cuyo elemento ya no existe NO acusa a la página — se retira. Sin
  // esto, quitar el carrito dejaría la suite roja para siempre y el dueño
  // aprendería a ignorar el ámbar.
  it("🔴 una promesa cuyo selector ya no existe se retira, no acusa", async () => {
    const fantasma: PruebaGuardada = {
      id: "p-fantasma",
      pagina: null,
      creada: 1,
      pasos: [{ clic: "#no-existe", entonces: [{ donde: "#total", que: "cambia" }] }],
    };
    const v = await mirar(RUNTIME_BUENO, [fantasma]);
    expect(v.retirarPruebas ?? []).toContain("p-fantasma");
    expect(v.regresiones ?? []).toEqual([]);
  }, 120_000);

  // CONTRA-PRUEBA: sin promesas guardadas el turno se comporta como antes de
  // que la suite existiera. Sin ella, «no hay regresiones» podría significar
  // que este camino no corre en absoluto — que es como estaba ayer.
  it("CONTRA-PRUEBA: sin promesas guardadas no aparece ninguno de los dos campos", async () => {
    const v = await mirar(RUNTIME_ROTO, []);
    expect(v.regresiones).toBeUndefined();
    expect(v.retirarPruebas).toBeUndefined();
  }, 120_000);
});
