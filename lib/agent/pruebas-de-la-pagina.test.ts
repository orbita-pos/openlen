// LA SUITE DE LA PÁGINA — que una promesa cumplida siga cumpliéndose.
//
// 🔴 POR QUÉ EXISTE. Hoy la promesa del modelo (`session.behaviorSpec`) vive en
// la SESIÓN y se muere con el turno: los ojos la comprueban al cerrar y ahí se
// acaba. Consecuencia, y no la estaba mirando nadie: OpenLen no detecta
// regresiones de comportamiento. El turno 3 construye el carrito y lo
// comprueba; el turno 9 reescribe el runtime —`editar_runtime` manda el código
// COMPLETO, no un parche— y si se lo lleva por delante, no se entera ni el
// modelo, ni los ojos, ni el dueño.
//
// LA REGLA CENTRAL, y sale de una medición de esta casa: NACE EN VERDE. Una
// prueba entra en la suite sólo si corrió y PASÓ en el turno que la creó.
// `verify.ts` (04/09) anotó por qué una prueba que falla hoy no acusa a nadie:
// «de los 3 fallos de `prueba` de la corrida de 16 páginas, CERO eran de la
// página… un comprobador que acierta 0 de 3 no puede declarar rota la página de
// nadie». Aquellas tres NUNCA pasaron —un verbo que faltaba y dos que pulsaban
// «enviar» sin rellenar campos `required`—, así que ninguna habría entrado.
//
// Y esa es toda la diferencia: una promesa que se cumplió sobre una página que
// funcionaba, y que falla DESPUÉS de otra edición, ya no es la opinión del
// modelo que escribió el código — es un cambio en la página. Cambia quién es el
// testigo, que es la frase con la que ese mismo fichero separa lo que puede
// acusar de lo que no.
import { describe, expect, it } from "vitest";

import {
  guardarSiNaceEnVerde,
  selectoresDe,
  vivas,
  TOPE_PRUEBAS_POR_PAGINA,
  type PruebaGuardada,
} from "./pruebas-de-la-pagina";

const PASOS = [{ clic: "#agregar", entonces: [{ donde: "#total", que: "cambia" as const }] }];

const CON_CARRITO =
  '<html><body><button id="agregar">Añadir</button><b id="total">0 €</b></body></html>';

describe("la suite de la página", () => {
  it("🔴 una prueba que PASÓ entra en la suite", () => {
    const suite = guardarSiNaceEnVerde([], { pasos: PASOS, fallos: [], pagina: null, ahora: 1 });
    expect(suite).toHaveLength(1);
    expect(suite[0]!.pasos).toEqual(PASOS);
    expect(suite[0]!.pagina).toBeNull();
  });

  // LA CONTRA-PRUEBA QUE SOSTIENE EL DISEÑO. Sin ella, la suite se llena de las
  // pruebas mal escritas —las que acusaron 0 de 3— y el ámbar se vuelve ruido.
  it("🔴 CONTRA-PRUEBA: una prueba que falló NO entra", () => {
    const suite = guardarSiNaceEnVerde([], {
      pasos: PASOS,
      fallos: [{ paso: 1, mensaje: "no cambió" }],
      pagina: null,
      ahora: 1,
    });
    expect(suite).toEqual([]);
  });

  // Ni siquiera cuando lo que falló fue la PRUEBA y no la página: si el
  // selector no señalaba a nada, esa promesa no se cumplió nunca.
  it("CONTRA-PRUEBA: un fallo `deLaPrueba` tampoco la deja entrar", () => {
    const suite = guardarSiNaceEnVerde([], {
      pasos: PASOS,
      fallos: [{ paso: 1, mensaje: "el selector no señala a nada", deLaPrueba: true }],
      pagina: null,
      ahora: 1,
    });
    expect(suite).toEqual([]);
  });

  it("un turno sin prueba deja la suite como estaba", () => {
    const guardadas: PruebaGuardada[] = [{ id: "p1", pasos: PASOS, pagina: null, creada: 1 }];
    expect(guardarSiNaceEnVerde(guardadas, { pasos: [], fallos: [], pagina: null })).toEqual(
      guardadas,
    );
  });

  // ─── El ciclo de vida ──────────────────────────────────────────────────────

  it("🔴 una promesa cuyo selector ya no está se retira sola", () => {
    const guardadas: PruebaGuardada[] = [{ id: "p1", pasos: PASOS, pagina: null, creada: 1 }];
    expect(vivas(guardadas, "<html><body><div id=\"otro\"></div></body></html>")).toEqual([]);
    expect(vivas(guardadas, CON_CARRITO)).toHaveLength(1);
  });

  // Media promesa tampoco vale: si el botón sigue pero el total desapareció, no
  // hay nada que comprobar y quedaría roja para siempre.
  it("basta con que falte UNO de sus selectores", () => {
    const guardadas: PruebaGuardada[] = [{ id: "p1", pasos: PASOS, pagina: null, creada: 1 }];
    const sinTotal = '<html><body><button id="agregar">Añadir</button></body></html>';
    expect(vivas(guardadas, sinTotal)).toEqual([]);
  });

  // 🔴 NO SE MATA LO QUE NO SE SABE LEER. La receta manda usar ids, pero una
  // prueba con otro selector se deja viva: retirarla aquí sería perder una
  // comprobación en silencio, que es el defecto que este repo persigue. Si de
  // verdad ya no señala a nada, el navegador lo dirá con `deLaPrueba`.
  it("un selector que no es un id se deja vivo", () => {
    const porClase: PruebaGuardada[] = [
      {
        id: "p1",
        pasos: [{ clic: ".boton", entonces: [{ donde: ".total", que: "cambia" as const }] }],
        pagina: null,
        creada: 1,
      },
    ];
    expect(vivas(porClase, "<html><body></body></html>")).toHaveLength(1);
  });

  it("las de OTRA página no se tocan", () => {
    const otras: PruebaGuardada[] = [{ id: "p1", pasos: PASOS, pagina: "menu", creada: 1 }];
    expect(vivas(otras, "<html><body></body></html>", "precios")).toEqual(otras);
  });

  it("mira los selectores de `escribe`, no sólo los de `clic`", () => {
    expect(
      selectoresDe([
        {
          clic: "#enviar",
          escribe: { "#correo": "a@b.c" },
          entonces: [{ donde: "#gracias", que: "visible" as const }],
        },
      ]),
    ).toEqual(["#enviar", "#correo", "#gracias"]);
  });

  // ─── Que no crezca sin freno ───────────────────────────────────────────────

  it("la misma promesa no se duplica: la nueva reemplaza a la vieja", () => {
    const suite = guardarSiNaceEnVerde(
      [{ id: "p1", pasos: PASOS, pagina: null, creada: 1 }],
      { pasos: PASOS, fallos: [], pagina: null, ahora: 2 },
    );
    expect(suite).toHaveLength(1);
    expect(suite[0]!.creada).toBe(2);
  });

  it("con el tope lleno entra la nueva y se va la más vieja", () => {
    const llena: PruebaGuardada[] = Array.from({ length: TOPE_PRUEBAS_POR_PAGINA }, (_, i) => ({
      id: `p${i}`,
      pasos: [{ clic: `#b${i}`, entonces: [{ donde: `#t${i}`, que: "cambia" as const }] }],
      pagina: null,
      creada: i,
    }));
    const suite = guardarSiNaceEnVerde(llena, { pasos: PASOS, fallos: [], pagina: null, ahora: 99 });
    expect(suite).toHaveLength(TOPE_PRUEBAS_POR_PAGINA);
    expect(suite.some((p) => p.id === "p0")).toBe(false);
    expect(suite.some((p) => p.creada === 99)).toBe(true);
  });

  // El tope es POR PÁGINA: llenar la home no puede tirar las promesas del menú.
  it("el tope no se lleva por delante las de otra página", () => {
    const llena: PruebaGuardada[] = [
      ...Array.from({ length: TOPE_PRUEBAS_POR_PAGINA }, (_, i) => ({
        id: `h${i}`,
        pasos: [{ clic: `#b${i}`, entonces: [{ donde: `#t${i}`, que: "cambia" as const }] }],
        pagina: null,
        creada: i,
      })),
      { id: "menu1", pasos: PASOS, pagina: "menu", creada: 0 },
    ];
    const suite = guardarSiNaceEnVerde(llena, { pasos: PASOS, fallos: [], pagina: null, ahora: 99 });
    expect(suite.filter((p) => p.pagina === "menu")).toHaveLength(1);
    expect(suite.filter((p) => p.pagina === null)).toHaveLength(TOPE_PRUEBAS_POR_PAGINA);
  });
});
