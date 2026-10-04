import { describe, expect, it } from "vitest";
import { turnChanges, wroteOnlyItsOwnPage } from "./turn-changes";

const lugar = (p: string) => p;
const INICIO = '<body><header id="hero"><h1>Briso para todos</h1></header><section id="sabores"><h2>Sabores</h2></section></body>';
const INICIO_EDITADO = INICIO.replace("Briso para todos", "Briso para ti");
const SERVICIOS = '<body><section id="servicios"><h1>Lo que hacemos</h1></section><footer>pie</footer></body>';

describe("turnChanges", () => {
  it("un turno de la página que empezó cuenta su diff", () => {
    const turn = { actions: [], preEditHtml: INICIO, postEditHtml: INICIO_EDITADO, page: null, paginasTocadas: [null] };
    expect(turnChanges(turn, lugar)).toEqual([{ tipo: "cambiada", etiqueta: "Briso para ti", indice: 0 }]);
  });

  it("un turno que escribió OTRA página no compara Inicio con Servicios (visto en el taller: 12 cambios inventados)", () => {
    const turn = { actions: [], preEditHtml: INICIO, postEditHtml: SERVICIOS, page: null, paginasTocadas: ["servicios"] };
    expect(turnChanges(turn, lugar)).toEqual([]);
  });

  it("si tocó la suya Y otra, tampoco: el último html puede ser de cualquiera de las dos", () => {
    const turn = { actions: [], preEditHtml: INICIO, postEditHtml: SERVICIOS, page: null, paginasTocadas: [null, "servicios"] };
    expect(turnChanges(turn, lugar)).toEqual([]);
  });

  it("las ops mandan aunque haya tocado otra página: son lo que se ejecutó, no un diff", () => {
    const turn = {
      actions: [{ ops: [{ tipo: "replace", donde: "documento" as const, etiqueta: "Lo que hacemos", indice: 0 }] }],
      preEditHtml: INICIO,
      postEditHtml: SERVICIOS,
      page: null,
      paginasTocadas: ["servicios"],
    };
    expect(turnChanges(turn as never, lugar)).toEqual([{ tipo: "cambiada", etiqueta: "Lo que hacemos", indice: 0 }]);
  });
});

describe("wroteOnlyItsOwnPage", () => {
  it("escribir varias veces su propia página es escribir la suya", () => {
    expect(wroteOnlyItsOwnPage({ page: null, paginasTocadas: [null, null] })).toBe(true);
    expect(wroteOnlyItsOwnPage({ page: "servicios", paginasTocadas: ["servicios"] })).toBe(true);
  });

  it("otra página no es la suya", () => {
    expect(wroteOnlyItsOwnPage({ page: null, paginasTocadas: ["servicios"] })).toBe(false);
    expect(wroteOnlyItsOwnPage({ page: "servicios", paginasTocadas: ["servicios", null] })).toBe(false);
  });

  it("sin páginas tocadas (no escribió, o turno de ai-design) no hay nada que contradiga", () => {
    expect(wroteOnlyItsOwnPage({ page: "servicios" })).toBe(true);
    expect(wroteOnlyItsOwnPage({ page: null, paginasTocadas: [] })).toBe(true);
  });

  it("un turno anterior al multipágina (sin page) no se juzga", () => {
    expect(wroteOnlyItsOwnPage({ paginasTocadas: ["servicios"] })).toBe(true);
  });
});
