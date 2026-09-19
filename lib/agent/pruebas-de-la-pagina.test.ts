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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  actualizarSuite,
  avisoDeRegresion,
  guardarSiNaceEnVerde,
  repartirFallos,
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

  // ─── Lo que la ruta guarda al cerrar el turno ──────────────────────────────
  //
  // Un solo sitio donde se decide cómo queda la suite, porque la ruta hace dos
  // cosas a la vez —retirar las que el navegador dijo que ya no señalan a nada
  // y guardar la que acaba de nacer en verde— y hacerlas en dos pasos sueltos
  // dentro de un fichero de 1.500 líneas es como se pierde una.
  describe("actualizarSuite", () => {
    const P1: PruebaGuardada = { id: "p1", pasos: PASOS, pagina: null, creada: 1 };

    it("🔴 retira las que el navegador mandó retirar", () => {
      expect(actualizarSuite([P1], { retirar: ["p1"] })).toEqual([]);
    });

    it("🔴 guarda la del turno si nació en verde", () => {
      const suite = actualizarSuite([], {
        turno: { pasos: PASOS, fallos: [], pagina: null, ahora: 5 },
      });
      expect(suite).toHaveLength(1);
      expect(suite[0]!.creada).toBe(5);
    });

    // Las dos cosas a la vez, que es el caso real: el turno rompe una promesa
    // vieja cuyo elemento ya no está y declara una nueva que pasa.
    it("🔴 retira y guarda en la misma pasada", () => {
      const otra = [{ clic: "#mas", entonces: [{ donde: "#total", que: "cambia" as const }] }];
      const suite = actualizarSuite([P1], {
        retirar: ["p1"],
        turno: { pasos: otra, fallos: [], pagina: null, ahora: 5 },
      });
      expect(suite).toHaveLength(1);
      expect(suite[0]!.pasos).toEqual(otra);
    });

    // CONTRA-PRUEBA: un turno que no declara nada y no retira nada deja la
    // suite intacta. Sin esto, cualquier turno podría vaciarla sin que se note.
    it("CONTRA-PRUEBA: sin cambios la suite queda igual", () => {
      expect(actualizarSuite([P1], {})).toEqual([P1]);
    });
  });

  // ─── Lo que se dice cuando una promesa se rompe ────────────────────────────
  //
  // Tres piezas, las mismas de Claude Code: QUÉ dejó de cumplirse, POR QUÉ lo
  // sabemos —se cumplió antes, sobre esta misma página— y QUÉ hacer. La tercera
  // es del dueño: los ojos corren al CERRAR el turno, así que el modelo no
  // puede arreglarlo sobre la marcha; lo lee en el turno siguiente.
  describe("avisoDeRegresion", () => {
    it("🔴 nombra lo que dejó de funcionar y dice qué hacer", () => {
      const aviso = avisoDeRegresion([
        { id: "p1", paso: 1, mensaje: "#total ya no cambia al pulsar #agregar" },
      ]);
      expect(aviso).toContain("#total ya no cambia al pulsar #agregar");
      expect(aviso).toMatch(/ya (hacía|funcionaba)|antes/i);
      expect(aviso).toMatch(/compruéba|pruéba/i);
    });

    it("con varias, las cuenta en vez de encadenarlas", () => {
      const aviso = avisoDeRegresion([
        { id: "p1", paso: 1, mensaje: "#total ya no cambia" },
        { id: "p2", paso: 2, mensaje: "#vaciar no vacía" },
      ]);
      expect(aviso).toContain("#total ya no cambia");
      expect(aviso).toContain("#vaciar no vacía");
    });

    // CONTRA-PRUEBA: sin regresiones no hay frase. Una cadena vacía pintaría
    // una tarjeta ámbar en blanco en un turno sano.
    it("CONTRA-PRUEBA: sin regresiones no dice nada", () => {
      expect(avisoDeRegresion([])).toBe("");
    });
  });

  // ─── Los eslabones del turno ───────────────────────────────────────────────
  //
  // Igual que `motivo-llega-a-la-tarjeta.test.ts`, y por el mismo motivo: un
  // campo nuevo cruza varios ficheros y el que se olvida no rompe nada — todo
  // compila, las pruebas de al lado siguen verdes y la suite simplemente no se
  // guarda. Aquí la cadena es corta y son tres pasos:
  //   1 · la ruta PASA las guardadas a los ojos,
  //   2 · los ojos devuelven los fallos del turno CRUDOS —de ellos depende que
  //       la promesa nazca en verde, y eso no se lee de una frase en prosa—,
  //   3 · la ruta GUARDA con `actualizarSuite`.
  describe("los tres eslabones del turno", () => {
    const lee = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

    it("1 · la ruta pasa las promesas vivas a los ojos", () => {
      const ruta = lee("app", "api", "agent", "route.ts");
      expect(ruta).toMatch(/guardadas: vivas\(project\.data\.pruebas \?\? \[\]/);
    });

    it("2 · los ojos devuelven los fallos del turno crudos", () => {
      const ojos = lee("lib", "agent", "verify.ts");
      expect(ojos).toContain("verdict.fallosDelTurno = h.fallosSpec");
      // Y las regresiones por su canal, que es de lo que va todo esto.
      expect(ojos).toContain("verdict.regresiones = h.regresiones");
    });

    it("3 · la ruta guarda la suite al cerrar el turno", () => {
      const ruta = lee("app", "api", "agent", "route.ts");
      expect(ruta).toMatch(/actualizarSuite\(actual\.pruebas \?\? \[\], cambios\)/);
      // Con los fallos del turno, que es lo que decide si nace en verde.
      expect(ruta).toMatch(/fallos: verdict\.fallosDelTurno \?\? \[\]/);
    });
  });

  // ─── Repartir lo que el navegador devuelve ─────────────────────────────────
  //
  // Los ojos corren UN solo programa con los pasos de la prueba del turno
  // seguidos de los de las guardadas, así que lo que vuelve es una lista plana
  // de fallos numerados (`leerFallos` da el paso en base 1). Repartirlos es lo
  // que decide de qué se acusa a quién, y por eso se prueba aquí —puro— y no
  // con un navegador.
  describe("repartirFallos", () => {
    const P1: PruebaGuardada = {
      id: "p1",
      pasos: [{ clic: "#agregar", entonces: [{ donde: "#total", que: "cambia" as const }] }],
      pagina: null,
      creada: 1,
    };
    const P2: PruebaGuardada = {
      id: "p2",
      pasos: [
        { clic: "#mas", entonces: [{ donde: "#total", que: "cambia" as const }] },
        { clic: "#vaciar", entonces: [{ donde: "#total", que: "es" as const, valor: "0 €" }] },
      ],
      pagina: null,
      creada: 2,
    };

    it("🔴 un fallo dentro de la prueba del turno NO es una regresión", () => {
      const r = repartirFallos([{ paso: 1, mensaje: "no cambió" }], 2, [P1]);
      expect(r.delTurno).toHaveLength(1);
      expect(r.regresiones).toEqual([]);
      expect(r.retirar).toEqual([]);
    });

    it("🔴 un fallo más allá de la prueba del turno es la promesa que se rompió", () => {
      // 2 pasos del turno, luego P1 (1 paso) y P2 (2 pasos): el paso 4 es el
      // primero de P2.
      const r = repartirFallos([{ paso: 4, mensaje: "#total no cambió" }], 2, [P1, P2]);
      expect(r.delTurno).toEqual([]);
      expect(r.regresiones).toEqual([{ id: "p2", paso: 1, mensaje: "#total no cambió" }]);
    });

    it("🔴 señala la promesa correcta cuando hay varias", () => {
      const r = repartirFallos([{ paso: 3, mensaje: "nada" }], 2, [P1, P2]);
      expect(r.regresiones[0]!.id).toBe("p1");
      expect(r.regresiones[0]!.paso).toBe(1);
    });

    // 🔴 `deLaPrueba` NO ACUSA. La bandera la pone el navegador cuando el
    // selector no señala a nada: eso no es la página rota, es la promesa que ya
    // no tiene sentido. Se retira, que es lo mismo que hace `vivas` en el
    // servidor — ésta es la red que caza los selectores que allí no se saben
    // leer.
    it("🔴 una guardada con `deLaPrueba` se RETIRA, no acusa", () => {
      const r = repartirFallos(
        [{ paso: 3, mensaje: "el selector no señala a nada", deLaPrueba: true }],
        2,
        [P1, P2],
      );
      expect(r.regresiones).toEqual([]);
      expect(r.retirar).toEqual(["p1"]);
    });

    it("sin guardadas no hay regresiones que repartir", () => {
      const r = repartirFallos([{ paso: 1, mensaje: "x" }], 1, []);
      expect(r.delTurno).toHaveLength(1);
      expect(r.regresiones).toEqual([]);
    });

    // CONTRA-PRUEBA del reparto: un fallo con un paso imposible no se le cuelga
    // a la última promesa por descarte. Acusar a la promesa equivocada manda al
    // modelo a arreglar lo que no está roto.
    it("CONTRA-PRUEBA: un paso fuera de rango no acusa a nadie", () => {
      const r = repartirFallos([{ paso: 99, mensaje: "x" }], 2, [P1, P2]);
      expect(r.regresiones).toEqual([]);
      expect(r.retirar).toEqual([]);
    });
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
