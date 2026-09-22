// LA SUITE DE LA PÁGINA — que una promesa cumplida siga cumpliéndose.
//
// 🔴 POR QUÉ EXISTE. Hoy la promesa del modelo (`session.behaviorJs`) vive en
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
  marcarRegresiones,
  migrarSuite,
  pasosAJs,
  repartirFallos,
  selectoresDe,
  selectoresDelCodigo,
  vivas,
  TOPE_PRUEBAS_POR_PAGINA,
  type PruebaGuardada,
} from "./pruebas-de-la-pagina";

const PASOS = [{ clic: "#agregar", entonces: [{ donde: "#total", que: "cambia" as const }] }];
/** La MISMA promesa, en la forma que se guarda desde el 2026-09-22. */
const CODIGO = 'var t = await ui.texto("#total"); await ui.clic("#agregar"); await ui.cambiaDe("#total", t);';

const CON_CARRITO =
  '<html><body><button id="agregar">Añadir</button><b id="total">0 €</b></body></html>';

describe("la suite de la página", () => {
  it("🔴 una prueba que PASÓ entra en la suite", () => {
    const suite = guardarSiNaceEnVerde([], { codigo: CODIGO, fallos: [], pagina: null, ahora: 1 });
    expect(suite).toHaveLength(1);
    expect(suite[0]!.codigo).toBe(CODIGO);
    expect(suite[0]!.pagina).toBeNull();
  });

  // LA CONTRA-PRUEBA QUE SOSTIENE EL DISEÑO. Sin ella, la suite se llena de las
  // pruebas mal escritas —las que acusaron 0 de 3— y el ámbar se vuelve ruido.
  it("🔴 CONTRA-PRUEBA: una prueba que falló NO entra", () => {
    const suite = guardarSiNaceEnVerde([], {
      codigo: CODIGO,
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
      codigo: CODIGO,
      fallos: [{ paso: 1, mensaje: "el selector no señala a nada", deLaPrueba: true }],
      pagina: null,
      ahora: 1,
    });
    expect(suite).toEqual([]);
  });

  it("un turno sin prueba deja la suite como estaba", () => {
    const guardadas: PruebaGuardada[] = [{ id: "p1", codigo: CODIGO, pagina: null, creada: 1 }];
    expect(guardarSiNaceEnVerde(guardadas, { codigo: "", fallos: [], pagina: null })).toEqual(
      guardadas,
    );
  });

  // ─── El ciclo de vida ──────────────────────────────────────────────────────

  it("🔴 una promesa cuyo selector ya no está se retira sola", () => {
    const guardadas: PruebaGuardada[] = [{ id: "p1", codigo: CODIGO, pagina: null, creada: 1 }];
    expect(vivas(guardadas, "<html><body><div id=\"otro\"></div></body></html>")).toEqual([]);
    expect(vivas(guardadas, CON_CARRITO)).toHaveLength(1);
  });

  // Media promesa tampoco vale: si el botón sigue pero el total desapareció, no
  // hay nada que comprobar y quedaría roja para siempre.
  it("basta con que falte UNO de sus selectores", () => {
    const guardadas: PruebaGuardada[] = [{ id: "p1", codigo: CODIGO, pagina: null, creada: 1 }];
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
    const otras: PruebaGuardada[] = [{ id: "p1", codigo: CODIGO, pagina: "menu", creada: 1 }];
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
      [{ id: "p1", codigo: CODIGO, pagina: null, creada: 1 }],
      { codigo: CODIGO, fallos: [], pagina: null, ahora: 2 },
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
    const suite = guardarSiNaceEnVerde(llena, { codigo: CODIGO, fallos: [], pagina: null, ahora: 99 });
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
    const P1: PruebaGuardada = { id: "p1", codigo: CODIGO, pagina: null, creada: 1 };

    it("🔴 retira las que el navegador mandó retirar", () => {
      expect(actualizarSuite([P1], { retirar: ["p1"] })).toEqual([]);
    });

    it("🔴 guarda la del turno si nació en verde", () => {
      const suite = actualizarSuite([], {
        turno: { codigo: CODIGO, fallos: [], pagina: null, ahora: 5 },
      });
      expect(suite).toHaveLength(1);
      expect(suite[0]!.creada).toBe(5);
    });

    // Las dos cosas a la vez, que es el caso real: el turno rompe una promesa
    // vieja cuyo elemento ya no está y declara una nueva que pasa.
    it("🔴 retira y guarda en la misma pasada", () => {
      const otra = 'var t = await ui.texto("#total"); await ui.clic("#mas"); await ui.cambiaDe("#total", t);';
      const suite = actualizarSuite([P1], {
        retirar: ["p1"],
        turno: { codigo: otra, fallos: [], pagina: null, ahora: 5 },
      });
      expect(suite).toHaveLength(1);
      expect(suite[0]!.codigo).toBe(otra);
    });

    // CONTRA-PRUEBA: un turno que no declara nada y no retira nada deja la
    // suite intacta. Sin esto, cualquier turno podría vaciarla sin que se note.
    it("CONTRA-PRUEBA: sin cambios la suite queda igual", () => {
      expect(actualizarSuite([P1], {})).toEqual([P1]);
    });

    // ─── La muerte por selector, DURADERA ────────────────────────────────────
    //
    // Hasta aquí `vivas` sólo filtraba al LEER —lo que se le pasa a los ojos—,
    // así que una promesa muerta seguía en la base para siempre: invisible pero
    // ocupando sitio, y el tope de 8 por página se llenaría de fantasmas. Al
    // guardar se mide contra el documento que de verdad quedó.
    it("🔴 retira contra el documento que se acaba de guardar", () => {
      const suite = actualizarSuite([P1], {
        documento: "<html><body><p>sin carrito</p></body></html>",
        pagina: null,
      });
      expect(suite).toEqual([]);
    });

    it("conserva la que sigue señalando a algo", () => {
      expect(actualizarSuite([P1], { documento: CON_CARRITO, pagina: null })).toHaveLength(1);
    });

    // La del turno acaba de pasar SOBRE ese documento, así que entra igual: se
    // limpia antes de añadir, no después.
    it("la promesa del turno entra aunque se limpie el resto", () => {
      const suite = actualizarSuite([P1], {
        documento: CON_CARRITO,
        pagina: null,
        turno: { codigo: CODIGO, fallos: [], pagina: null, ahora: 9 },
      });
      expect(suite).toHaveLength(1);
      expect(suite[0]!.creada).toBe(9);
    });

    // CONTRA-PRUEBA: sin documento no se limpia nada. Un turno que no sabe qué
    // documento quedó no puede vaciar la suite por si acaso.
    it("CONTRA-PRUEBA: sin documento no se retira por selector", () => {
      expect(actualizarSuite([P1], { pagina: null })).toEqual([P1]);
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

  // ─── El contador, que es quien decide lo que falta ─────────────────────────
  //
  // El aviso no se manda a ciegas: se mide si sirvió.
  // Aquí decide lo ÚNICO que el plan dejó abierto a propósito — si una
  // regresión puede llegar a declarar rota la página—, y esa decisión se toma
  // con el número delante, no con ganas.
  //
  // 🔴 LA MEMORIA VIVE EN LA PROMESA, no en la sesión: la sesión se muere con
  // el turno y esto tiene que cruzar turnos. Una promesa rota lleva su marca
  // hasta que vuelve a cumplirse.
  describe("marcarRegresiones", () => {
    const P1: PruebaGuardada = { id: "p1", codigo: CODIGO, pagina: null, creada: 1 };
    const P2: PruebaGuardada = { id: "p2", codigo: CODIGO, pagina: "menu", creada: 2 };

    it("🔴 una promesa que se rompe queda marcada, y se cuenta como NUEVA", () => {
      const { suite, cuenta } = marcarRegresiones([P1], {
        comprobadas: ["p1"],
        rotas: ["p1"],
        ahora: 7,
      });
      expect(suite[0]!.rota).toBe(7);
      expect(cuenta).toEqual({ nuevas: 1, siguenRotas: 0, arregladas: 0 });
    });

    it("🔴 la que vuelve a cumplirse se desmarca y cuenta como ARREGLADA", () => {
      const { suite, cuenta } = marcarRegresiones([{ ...P1, rota: 5 }], {
        comprobadas: ["p1"],
        rotas: [],
        ahora: 7,
      });
      expect(suite[0]!.rota).toBeUndefined();
      expect(cuenta.arregladas).toBe(1);
    });

    it("🔴 la que sigue rota no se cuenta dos veces como nueva", () => {
      const { suite, cuenta } = marcarRegresiones([{ ...P1, rota: 5 }], {
        comprobadas: ["p1"],
        rotas: ["p1"],
        ahora: 7,
      });
      // Conserva la marca ORIGINAL: cuándo se rompió, no cuándo se miró.
      expect(suite[0]!.rota).toBe(5);
      expect(cuenta).toEqual({ nuevas: 0, siguenRotas: 1, arregladas: 0 });
    });

    // CONTRA-PRUEBA: una promesa que NO se comprobó este turno —otra página, o
    // fuera del tope— no se toca. Sin esto, un turno en la home «arreglaría»
    // todas las promesas rotas del menú sin haberlas mirado.
    it("CONTRA-PRUEBA: la que no se comprobó no se toca ni se cuenta", () => {
      const { suite, cuenta } = marcarRegresiones([{ ...P2, rota: 5 }], {
        comprobadas: [],
        rotas: [],
        ahora: 7,
      });
      expect(suite[0]!.rota).toBe(5);
      expect(cuenta).toEqual({ nuevas: 0, siguenRotas: 0, arregladas: 0 });
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
      // MIGRADAS AL LEER: la forma vieja pasa a JS antes de filtrarse.
      expect(ruta).toMatch(/const migrada = migrarSuite\(project\.data\.pruebas \?\? \[\]\)/);
      expect(ruta).toMatch(/const promesasDeLaPagina = vivas\(migrada\.suite/);
      expect(ruta).toContain("guardadas: promesasDeLaPagina");
    });

    it("2 · los ojos devuelven los fallos del turno crudos", () => {
      const ojos = lee("lib", "agent", "verify.ts");
      expect(ojos).toContain("verdict.fallosDelTurno = h.fallosSpec");
      // Y las regresiones por su canal, que es de lo que va todo esto.
      expect(ojos).toContain("verdict.regresiones = h.regresiones");
    });

    it("4 · la ruta CUENTA lo que le pasó a la suite", () => {
      const ruta = lee("app", "api", "agent", "route.ts");
      expect(ruta).toContain("marcarRegresiones(migrarSuite(actual.pruebas ?? []).suite");
      // Con las que de verdad se comprobaron: sin eso, un turno en la home
      // daría por arregladas las promesas del menú.
      // Las que NO corrieron no cuentan como comprobadas: si no, una rota que
      // no se miró saldría «arreglada».
      expect(ruta).toMatch(/comprobadas: promesasDeLaPagina\.filter\(\(p\) => !sinCorrer\.has\(p\.id\)\)\.map/);
      expect(ruta).toMatch(/suite de la pagina: nuevas=/);
    });

    it("3 · la ruta guarda la suite al cerrar el turno", () => {
      const ruta = lee("app", "api", "agent", "route.ts");
      // Sobre las YA MARCADAS por el contador, no sobre las crudas: marcar y
      // guardar en el mismo paso es como se pierde uno de los dos.
      expect(ruta).toContain("actualizarSuite(marcadas, {");
      // Y limpia contra el documento que quedó EN LA BASE, no contra el del
      // turno: entre medias pudo entrar otra escritura.
      expect(ruta).toMatch(/const documento = pageSlug/);
      expect(ruta).toMatch(/\.\.\.\(documento \? \{ documento, pagina: pageSlug \} : \{\}\)/);
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
    const P1: PruebaGuardada = { id: "p1", codigo: CODIGO, pagina: null, creada: 1 };
    const P2: PruebaGuardada = {
      id: "p2",
      codigo: 'await ui.clic("#vaciar"); await ui.es("#total", "0 €");',
      pagina: null,
      creada: 2,
    };

    // POR PROGRAMA, no por paso: el 0 es la promesa del turno, el 1 la primera
    // guardada, el 2 la segunda. Cortar por número de paso era lo que, con un
    // programa JS, acusaba a una guardada de lo que había fallado otra.
    it("🔴 un fallo de la promesa del turno NO es una regresión", () => {
      const r = repartirFallos([{ paso: 3, mensaje: "no cambió", programa: 0 }], [P1], true);
      expect(r.delTurno).toHaveLength(1);
      expect(r.regresiones).toEqual([]);
      expect(r.retirar).toEqual([]);
    });

    it("🔴 un fallo de una guardada es la promesa que se rompió, con SU paso", () => {
      const r = repartirFallos([{ paso: 2, mensaje: "#total no es 0 €", programa: 2 }], [P1, P2], true);
      expect(r.delTurno).toEqual([]);
      expect(r.regresiones).toEqual([{ id: "p2", paso: 2, mensaje: "#total no es 0 €" }]);
    });

    it("🔴 sin promesa del turno, el programa 0 ya es la primera guardada", () => {
      const r = repartirFallos([{ paso: 1, mensaje: "nada", programa: 0 }], [P1, P2], false);
      expect(r.delTurno).toEqual([]);
      expect(r.regresiones[0]!.id).toBe("p1");
    });

    // 🔴 `deLaPrueba` NO ACUSA. La bandera la pone el navegador cuando el
    // selector no señala a nada: eso no es la página rota, es la promesa que ya
    // no tiene sentido. Se retira, que es lo mismo que hace `vivas` en el
    // servidor — ésta es la red que caza los selectores que allí no se saben
    // leer.
    it("🔴 una guardada con `deLaPrueba` se RETIRA, no acusa", () => {
      const r = repartirFallos(
        [{ paso: 1, mensaje: "no existe #agregar", deLaPrueba: true, programa: 1 }],
        [P1, P2],
        true,
      );
      expect(r.regresiones).toEqual([]);
      expect(r.retirar).toEqual(["p1"]);
    });

    it("sin guardadas no hay regresiones que repartir", () => {
      const r = repartirFallos([{ paso: 1, mensaje: "x", programa: 0 }], [], true);
      expect(r.delTurno).toHaveLength(1);
      expect(r.regresiones).toEqual([]);
    });

    // CONTRA-PRUEBA del reparto: un programa que no existe no se le cuelga a la
    // última promesa por descarte. Acusar a la equivocada manda al modelo a
    // arreglar lo que no está roto.
    it("CONTRA-PRUEBA: un programa fuera de rango no acusa a nadie", () => {
      const r = repartirFallos([{ paso: 1, mensaje: "x", programa: 9 }], [P1, P2], true);
      expect(r.regresiones).toEqual([]);
      expect(r.retirar).toEqual([]);
    });
  });

  // El tope es POR PÁGINA: llenar la home no puede tirar las promesas del menú.
  it("el tope no se lleva por delante las de otra página", () => {
    const llena: PruebaGuardada[] = [
      ...Array.from({ length: TOPE_PRUEBAS_POR_PAGINA }, (_, i) => ({
        id: `h${i}`,
        codigo: `await ui.clic("#b${i}"); await ui.visible("#t${i}");`,
        pagina: null,
        creada: i,
      })),
      { id: "menu1", codigo: CODIGO, pagina: "menu", creada: 0 },
    ];
    const suite = guardarSiNaceEnVerde(llena, { codigo: CODIGO, fallos: [], pagina: null, ahora: 99 });
    expect(suite.filter((p) => p.pagina === "menu")).toHaveLength(1);
    expect(suite.filter((p) => p.pagina === null)).toHaveLength(TOPE_PRUEBAS_POR_PAGINA);
  });
});

// ─── LA MIGRACIÓN: la suite pasa a JS (2026-09-22) ──────────────────────────
//
// La forma de las migraciones de Claude Code: corren solas al leer, son
// idempotentes, y lo viejo se sustituye SÓLO si la conversión salió bien. La
// que no se puede convertir se conserva y se nombra — nunca se tira en silencio.
describe("migrarSuite", () => {
  it("🔴 una guardada en DSL pasa a JS y pierde la forma vieja", () => {
    const { suite, sinMigrar } = migrarSuite([{ id: "p1", pasos: PASOS, pagina: null, creada: 1 }]);
    expect(sinMigrar).toEqual([]);
    expect(suite[0]!.pasos).toBeUndefined();
    expect(suite[0]!.codigo).toContain('ui.clic("#agregar", 1)');
    expect(suite[0]!.codigo).toContain('ui.cambiaDe("#total"');
    // Y conserva lo demás: id, página, fecha y su marca de rota.
    expect(suite[0]).toMatchObject({ id: "p1", pagina: null, creada: 1 });
  });

  it("🔴 la que no se puede convertir se CONSERVA y se nombra", () => {
    const rara = { id: "p9", pasos: [{ clic: "#a", entonces: [{ donde: "#b", que: "brilla" }] }], pagina: null, creada: 1 } as unknown as PruebaGuardada;
    const { suite, sinMigrar } = migrarSuite([rara]);
    expect(sinMigrar).toEqual(["p9"]);
    expect(suite).toEqual([rara]);
  });

  it("es idempotente: lo ya migrado no se toca", () => {
    const ya: PruebaGuardada = { id: "p1", codigo: CODIGO, pagina: null, creada: 1, rota: 5 };
    expect(migrarSuite([ya]).suite).toEqual([ya]);
    const una = migrarSuite([{ id: "p1", pasos: PASOS, pagina: null, creada: 1 }]).suite;
    expect(migrarSuite(una).suite).toEqual(una);
  });
});

describe("pasosAJs — cada verbo del DSL tiene su primitivo", () => {
  it("el orden del DSL: desplazar, escribir, pulsar, y el ANTES leído antes de actuar", () => {
    const js = pasosAJs([
      {
        desplaza: "#zona",
        escribe: { "#correo": "a@b.c" },
        clic: ".tab",
        cualquiera: true,
        veces: 2,
        entonces: [
          { donde: "#n", que: "cambia" },
          { donde: "#panel", que: "visible" },
          { donde: "#aviso", que: "contiene", valor: "Gracias" },
          { donde: "#btn", que: "atributo", valor: "disabled" },
        ],
      },
    ])!;
    const orden = ["ui.texto(\"#n\")", "ui.desplaza(\"#zona\", { cualquiera: true })", "ui.escribe(\"#correo\", \"a@b.c\")", "ui.clic(\".tab\", 2, { cualquiera: true })", "ui.cambiaDe(\"#n\"", "ui.visible(\"#panel\")", "ui.contiene(\"#aviso\", \"Gracias\")", "ui.atributoCambiaDe(\"#btn\", \"disabled\""];
    let desde = 0;
    for (const trozo of orden) {
      const i = js.indexOf(trozo, desde);
      expect(i, `falta o va fuera de orden: ${trozo}`).toBeGreaterThanOrEqual(0);
      desde = i;
    }
  });

  it("CONTRA-PRUEBA: lo que no sabe escribir devuelve null, no una promesa distinta", () => {
    expect(pasosAJs([{ clic: "#a", entonces: [{ donde: "#b", que: "contiene" }] }])).toBeNull();
    expect(pasosAJs([])).toBeNull();
  });
});

describe("selectoresDelCodigo", () => {
  it("lee los literales de las llamadas a ui.*, en orden", () => {
    expect(selectoresDelCodigo(CODIGO)).toEqual(["#total", "#agregar", "#total"]);
    expect(selectoresDelCodigo("await ui.clic('.tab', 1, { cualquiera: true });")).toEqual([".tab"]);
  });

  it("uno construido en tiempo de ejecución no se ve, y la promesa se queda viva", () => {
    const opaca: PruebaGuardada = { id: "p1", codigo: 'var s = "#" + "x"; await ui.clic(s);', pagina: null, creada: 1 };
    expect(selectoresDelCodigo(opaca.codigo!)).toEqual([]);
    expect(vivas([opaca], "<html><body></body></html>")).toHaveLength(1);
  });
});
