import { describe, expect, it } from "vitest";

import { compileCalcRegions } from "@/lib/expr/document";

import { mount, trackDocumentListeners } from "./test-helpers";

/**
 * LA VERIFICACIÓN 6 del plan de L2: "construir las peticiones como fixtures y
 * comprobar que caen. Si alguna no cae, las primitivas estaban mal."
 *
 * NO son calculadoras. El nombre de la receta (`calc`) engaña: lo que se
 * construyó es un lenguaje de expresiones con cuatro piezas que COMPONEN, y la
 * pregunta que este archivo responde con hechos es qué sale de combinarlas —
 * incluidos juegos, quizzes e interruptores que nadie pidió como tales.
 *
 * Cada caso se EJERCITA (se teclea, se hace clic, se lee el resultado). Un test
 * que sólo comprobara "compila" no probaría que la página hace algo.
 */
function region(inner: string): void {
  const html = `<!doctype html><html><body><div data-ol-calc>${inner}</div></body></html>`;
  const out = compileCalcRegions(html);
  expect(out.issues, `no compila: ${JSON.stringify(out.issues)}`).toEqual([]);
  mount(/<body>([\s\S]*)<\/body>/.exec(out.html)![1]!);
}

const $ = (s: string) => document.querySelector(s)!;
const txt = (s: string) => $(s).textContent;
const oculto = (s: string) => $(s).hasAttribute("data-ol-calc-off");
const type = (s: string, v: string) => {
  const el = $(s) as HTMLInputElement;
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const pick = (s: string) => {
  const el = $(s) as HTMLInputElement;
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const click = (s: string) => ($(s) as HTMLElement).click();

describe("JUEGOS — nadie pidió un motor de juegos y salen igual", () => {
  trackDocumentListeners();

  it("adivina el número: el secreto persiste entre intentos y da pistas", () => {
    region(
      `<button id="nuevo" data-ol-set="secreto = AZAR(1, 100)">Nuevo juego</button>` +
      `<input id="i" data-ol-val="intento" type="number" value="50">` +
      `<p id="p" data-ol-out="SI(intento = secreto, '¡Le diste!', SI(intento > secreto, 'Más bajo', 'Más alto'))">Empieza</p>`,
    );
    // Antes de empezar no hay secreto: respeta el texto del autor.
    expect(txt("#p")).toBe("Empieza");
    click("#nuevo");
    // Ya hay secreto y da una pista real — el secreto NO se ve en la página.
    expect(["Más bajo", "Más alto", "¡Le diste!"]).toContain(txt("#p"));
    expect($("[data-ol-calc]").outerHTML).not.toContain("secreto=");
    // Y sigue vivo tras un intento nuevo: la pista no se reinicia sola.
    const pista = txt("#p");
    type("#i", "50");
    expect(txt("#p")).toBe(pista);
  });

  it("piedra, papel o tijera contra la máquina", () => {
    region(
      `<ul data-ol-val="mano"><li data-ol-item>piedra</li><li data-ol-item>papel</li><li data-ol-item>tijera</li></ul>` +
      `<select id="tu" data-ol-val="tu"><option>piedra</option><option>papel</option><option>tijera</option></select>` +
      `<button id="go" data-ol-set="maq = AZAR(mano)">Tirar</button>` +
      `<p id="r" data-ol-out="SI(tu = maq, 'Empate', SI(UNE(tu, maq) = 'piedratijera' O UNE(tu, maq) = 'papelpiedra' O UNE(tu, maq) = 'tijerapapel', 'Ganaste', 'Perdiste'))">Elige</p>`,
    );
    expect(txt("#r")).toBe("Elige");
    click("#go");
    expect(["Empate", "Ganaste", "Perdiste"]).toContain(txt("#r"));
  });
});

describe("QUIZZES Y TESTS — radios, puntaje y un resultado de cuatro", () => {
  trackDocumentListeners();

  it("test de personalidad con 4 resultados por rango", () => {
    region(
      `<input id="a1" data-ol-val="p1" type="radio" value="0"><input id="a2" data-ol-val="p1" type="radio" value="3">` +
      `<input id="b1" data-ol-val="p2" type="radio" value="0"><input id="b2" data-ol-val="p2" type="radio" value="3">` +
      `<p id="r" data-ol-out="SI(SUMA(p1, p2) >= 6, 'Explorador', SI(SUMA(p1, p2) >= 3, 'Guardián', 'Soñador'))">?</p>`,
    );
    expect(txt("#r")).toBe("Soñador");
    pick("#a2");
    expect(txt("#r")).toBe("Guardián");
    pick("#b2");
    expect(txt("#r")).toBe("Explorador");
  });

  it("encuesta con resultado inmediato que aparece al responder", () => {
    region(
      `<input id="si" data-ol-val="voto" type="radio" value="si"><input id="no" data-ol-val="voto" type="radio" value="no">` +
      `<p id="gracias" data-ol-if="voto != ''">Gracias por votar</p>` +
      `<p id="eco" data-ol-out="UNE('Votaste: ', voto)">—</p>`,
    );
    expect(oculto("#gracias")).toBe(true);
    pick("#si");
    expect(oculto("#gracias")).toBe(false);
    expect(txt("#eco")).toBe("Votaste: si");
  });
});

describe("ELEGIR Y MOSTRAR — sin una sola cuenta de por medio", () => {
  trackDocumentListeners();

  it("comparador de planes: el clic resalta el elegido", () => {
    region(
      `<button id="bp" data-ol-set="plan = 'pro'">Pro</button>` +
      `<button id="bb" data-ol-set="plan = 'basico'">Básico</button>` +
      `<div id="dp" data-ol-if="plan = 'pro'">Elegiste Pro</div>` +
      `<div id="db" data-ol-if="plan = 'basico'">Elegiste Básico</div>`,
    );
    click("#bp");
    expect(oculto("#dp")).toBe(false);
    expect(oculto("#db")).toBe(true);
    click("#bb");
    expect(oculto("#dp")).toBe(true);
    expect(oculto("#db")).toBe(false);
  });

  it("el horario del día que elijas", () => {
    region(
      `<select id="d" data-ol-val="dia"><option>sabado</option><option>domingo</option></select>` +
      `<p id="s" data-ol-if="dia = 'sabado'">Sábado: 9 a 20</p>` +
      `<p id="dm" data-ol-if="dia = 'domingo'">Domingo: 10 a 14</p>`,
    );
    expect(oculto("#s")).toBe(false);
    expect(oculto("#dm")).toBe(true);
    const sel = $("#d") as HTMLSelectElement;
    sel.value = "domingo";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(oculto("#s")).toBe(true);
    expect(oculto("#dm")).toBe(false);
  });

  // Una casilla es la forma natural de un interruptor en HTML, y además evita
  // tener que declarar el estado a mano.
  it("interruptor mensual/anual, hecho con una casilla", () => {
    region(
      `<input id="sw" data-ol-val="anual" type="checkbox">` +
      `<p id="pr" data-ol-out="MONEDA(SI(anual, 1990, 199), 0)">199</p>` +
      `<p id="ah" data-ol-if="anual">Te ahorras dos meses</p>`,
    );
    expect(txt("#pr")).toBe("199");
    expect(oculto("#ah")).toBe(true);
    pick("#sw");
    expect(txt("#pr")).toBe("1,990");
    expect(oculto("#ah")).toBe(false);
  });
});

describe("LA FRONTERA — medida, y NO donde yo creía", () => {
  trackDocumentListeners();

  /**
   * CORRECCIÓN. Una versión anterior de este archivo afirmaba que un
   * acumulador y un tablero "NO caen". Es falso: lo que fallaba era que yo no
   * DECLARABA el estado. Un `data-ol-set` cuyo destino no existe en ninguna
   * parte queda bloqueado por la regla del gesto-no-ocurrido — pero declarar
   * ese destino como un campo lo desbloquea, y eso ya se puede hoy.
   *
   * La lección es sobre el método, no sobre el lenguaje: "lo probé y falló" no
   * es lo mismo que "no se puede", y la diferencia entre las dos frases era un
   * atributo.
   */
  it("un acumulador SÍ avanza cuando su estado está declarado", () => {
    region(
      `<input type="hidden" data-ol-val="n" value="0">` +
      `<button id="mas" data-ol-set="n = n + 1">+1</button>` +
      `<p id="v" data-ol-out="n">0</p>`,
    );
    click("#mas");
    click("#mas");
    click("#mas");
    expect(txt("#v")).toBe("3");
  });

  it("un tablero de tres celdas: pinta, y canta la línea al completarse", () => {
    region(
      `<input type="hidden" data-ol-val="c1" value=""><input type="hidden" data-ol-val="c2" value="">` +
      `<input type="hidden" data-ol-val="c3" value="">` +
      `<button id="b1" data-ol-set="c1 = 'X'">1</button>` +
      `<button id="b2" data-ol-set="c2 = 'X'">2</button>` +
      `<button id="b3" data-ol-set="c3 = 'X'">3</button>` +
      `<span id="s1" data-ol-out="c1">·</span>` +
      `<p id="g" data-ol-if="c1 = 'X' Y c2 = 'X' Y c3 = 'X'">¡Línea!</p>`,
    );
    // Nace bien: nada cantado y la celda vacía.
    expect(oculto("#g")).toBe(true);
    click("#b1");
    expect(txt("#s1")).toBe("X");
    click("#b2");
    expect(oculto("#g")).toBe(true);
    click("#b3");
    expect(oculto("#g")).toBe(false);
  });

  /**
   * LO QUE DE VERDAD NO CAE, y aquí sí es por diseño y no por un atributo que
   * falte: los BUCLES NO ACOTADOS. Zip, sudoku y los laberintos piden recorrer
   * celdas preguntando "¿el camino pasa por todas?" un número de veces que
   * depende del propio recorrido. Eso no es un hueco: es lo que impide que una
   * página se cuelgue, y Starlark (Google/Bazel) toma la misma decisión.
   *
   * Lo que SÍ hay desde L3 es iteración ACOTADA por el largo de una lista
   * (TODOS/ALGUNO/CUENTA_SI/FILTRA, la forma de CEL). Un tablero de 5x5
   * seguiría necesitando 25 nombres escritos a mano y toparía con MAX_NODES,
   * así que la frontera práctica no se movió para los juegos de cuadrícula —
   * pero sí para todo lo que se pueda PREGUNTAR sobre una lista.
   */
  it("un turno alterno SÍ cae: dos asignaciones en un gesto", () => {
    region(
      `<div data-ol-state="turno = 'X'; c1 = '·'; c2 = '·'"></div>` +
      `<button id="b1" data-ol-set="c1 = turno; turno = SI(turno = 'X', 'O', 'X')">1</button>` +
      `<button id="b2" data-ol-set="c2 = turno; turno = SI(turno = 'X', 'O', 'X')">2</button>` +
      `<span id="s1" data-ol-out="c1">·</span><span id="s2" data-ol-out="c2">·</span>` +
      `<span id="t" data-ol-out="turno">X</span>`,
    );
    expect(txt("#t")).toBe("X");
    click("#b1");
    // La ficha se puso Y el turno cambió, en el mismo clic.
    expect(txt("#s1")).toBe("X");
    expect(txt("#t")).toBe("O");
    click("#b2");
    expect(txt("#s2")).toBe("O");
    expect(txt("#t")).toBe("X");
  });

  it("un quiz multi-paso: UNA fórmula en vez de una por pregunta", () => {
    region(
      `<ul data-ol-val="preguntas"><li data-ol-item>¿Capital de Francia?</li>` +
      `<li data-ol-item>¿Cuántos continentes?</li></ul>` +
      `<div data-ol-state="i = 1"></div>` +
      `<p id="q" data-ol-out="ELEMENTO(preguntas, i)">·</p>` +
      `<button id="sig" data-ol-set="i = i + 1">Siguiente</button>` +
      `<p id="fin" data-ol-if="i > CUENTA(preguntas)">Terminaste</p>`,
    );
    expect(txt("#q")).toBe("¿Capital de Francia?");
    expect(oculto("#fin")).toBe(true);
    click("#sig");
    expect(txt("#q")).toBe("¿Cuántos continentes?");
    click("#sig");
    expect(oculto("#fin")).toBe(false);
  });

  it("un carrito con listas PARALELAS — sin objetos ni propiedades", () => {
    region(
      `<ul data-ol-val="nombres"><li data-ol-item>Café</li><li data-ol-item>Té</li></ul>` +
      `<ul data-ol-val="precios"><li data-ol-item>50</li><li data-ol-item>40</li></ul>` +
      `<select id="sel" data-ol-val="elegido"><option>Café</option><option>Té</option></select>` +
      `<p id="p" data-ol-out="MONEDA(ELEMENTO(precios, POSICION(nombres, elegido)), 0)">0</p>`,
    );
    expect(txt("#p")).toBe("50");
    const sel = $("#sel") as HTMLSelectElement;
    sel.value = "Té";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(txt("#p")).toBe("40");
  });

  it("una pregunta sobre TODA una lista, con iteración acotada", () => {
    region(
      `<ul data-ol-val="precios"><li data-ol-item>50</li><li data-ol-item>200</li>` +
      `<li data-ol-item>300</li></ul>` +
      `<input id="t" data-ol-val="tope" type="number" value="100">` +
      `<p id="n" data-ol-out="CUENTA_SI(precios, CADA > tope)">0</p>` +
      `<p id="s" data-ol-out="SUMA(FILTRA(precios, CADA > tope))">0</p>` +
      `<p id="todos" data-ol-if="TODOS(precios, CADA > tope)">Todos caros</p>`,
    );
    expect(txt("#n")).toBe("2");
    expect(txt("#s")).toBe("500");
    expect(oculto("#todos")).toBe(true);
    type("#t", "10");
    expect(txt("#n")).toBe("3");
    expect(oculto("#todos")).toBe(false);
  });

  /**
   * LO QUE DE VERDAD NO CAE, y aquí sí es por diseño y no por un atributo que
   * falte:
   *
   *   1. DOS asignaciones en un solo gesto. Un tres en raya de dos jugadores
   *      necesita, con un clic, poner la ficha Y alternar el turno.
   *      `data-ol-set` asigna UN nombre. Es un hueco pequeño y quitable — pero
   *      no se quita sin una petición real detrás.
   *
   *   2. BUCLES. Zip, sudoku y los laberintos piden recorrer celdas: "¿el
   *      camino pasa por todas?", "¿esta región tiene los nueve dígitos?". Eso
   *      no es un hueco: es la razón por la que una página no puede colgarse.
   *      Un tablero de 5x5 además necesitaría 25 nombres y sus reglas escritas
   *      a mano, y a los 128 nodos se topa con MAX_NODES.
   *
   * O sea: la frontera NO es "juegos sí/no" ni "tablero sí/no". Es el BUCLE.
   */
});
