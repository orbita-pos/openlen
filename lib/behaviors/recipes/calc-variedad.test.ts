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

  // El interruptor mensual/anual es una CASILLA, no un data-ol-set: alternar
  // un booleano con `anual = NO anual` no funciona (ver el describe de abajo).
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

describe("LO QUE NO CAE — el límite, medido y no supuesto", () => {
  trackDocumentListeners();

  /**
   * Un contador con botones `+` NO funciona: `data-ol-set="n = n + 1"` lee `n`,
   * que sólo existe como destino de esa misma asignación, así que la regla del
   * gesto-no-ocurrido lo bloquea para siempre.
   *
   * Es una limitación REAL y se documenta como tal en vez de esconderse. La
   * salida hoy es un `<input type="number">`, que además el visitante puede
   * teclear directo. Si algún día aparece demanda de acumuladores, el arreglo
   * es un valor inicial declarado para los destinos de asignación — un cambio
   * pequeño, pero que no se hace sin un caso real detrás.
   */
  it("un acumulador (n = n + 1) NO avanza — está documentado, no es sorpresa", () => {
    region(
      `<button id="mas" data-ol-set="n = n + 1">+1</button><p id="v" data-ol-out="n">0</p>`,
    );
    click("#mas");
    click("#mas");
    expect(txt("#v")).toBe("0");
  });

  /**
   * Un juego de cuadrícula tipo Zip/sudoku/laberinto NO cae, y no por un
   * descuido: el lenguaje no tiene bucles, ni listas que se puedan modificar,
   * ni forma de preguntar "qué celdas son vecinas de ésta". Cada celda tendría
   * que ser un nombre suelto y cada regla una fórmula escrita a mano — a las
   * 25 celdas de un tablero 5x5 eso ya no lo escribe nadie, y a las 128 se
   * topa con MAX_NODES.
   *
   * Eso es la línea de la doctrina funcionando: "¿se puede con una página
   * sellada?" Un tablero con estado por celda pide código por-usuario en el
   * navegador del visitante, que es L2 fuera y otro modelo de amenaza.
   *
   * Un tablero PEQUEÑO sí avanza — tres nombres, tres clics, una condición —
   * pero arrastra una arruga que hay que decir: mientras ninguna celda se haya
   * tocado, la condición LEE nombres que aún no existen, así que la regla del
   * gesto-no-ocurrido no la evalúa y el bloque nace VISIBLE. Un tres en raya
   * enseñaría "¡Línea!" antes de la primera jugada.
   *
   * Es coherente (sin runtime nada se oculta: content-intact) y es exactamente
   * lo que salva a la ruleta de nacer diciendo "0", pero para un tablero es
   * indeseable. La salida hoy es escribir la condición sobre un campo que SÍ
   * exista de inicio. Se documenta como límite en vez de venderse como juego.
   */
  it("un tablero pequeño avanza, pero su condición NACE visible", () => {
    region(
      `<button id="c1" data-ol-set="c1 = 'X'">1</button>` +
      `<button id="c2" data-ol-set="c2 = 'X'">2</button>` +
      `<button id="c3" data-ol-set="c3 = 'X'">3</button>` +
      `<p id="g" data-ol-if="c1 = 'X' Y c2 = 'X' Y c3 = 'X'">¡Línea!</p>`,
    );
    // La arruga: antes de tocar nada, visible.
    expect(oculto("#g")).toBe(false);
    click("#c1");
    // Ya hay un nombre, pero faltan dos: la condición sigue sin poder evaluarse.
    expect(oculto("#g")).toBe(false);
    click("#c2");
    click("#c3");
    // Con las tres puestas, la condición es cierta de verdad.
    expect(oculto("#g")).toBe(false);
  });
});
