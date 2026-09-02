import { describe, expect, it, vi } from "vitest";
import type { Op } from "@/lib/html-ops";
import { describirOps, parseOutline } from "./ops-descritas";

// Dos secciones, con sus descendientes dentro. Es la forma que devuelve el
// motor nativo; aquí se sirve a mano para que la prueba no cargue el binding.
const ANTES = "<antes/>";
const DESPUES = "<despues/>";
const OUTLINE_ANTES = '- [1] <header> "Taller El Norte"\n- [5] <section> "Precios"';
const OUTLINE_DESPUES = '- [1] <header> "Taller El Norte"\n- [4] <section> "Nueva"\n- [9] <section> "Precios"';
const SECCIONES: Record<string, string> = {
  "1": '<header data-op-id="1"><h1 data-op-id="2">Taller</h1></header>',
  "5": '<section data-op-id="5"><h2 data-op-id="6">Precios</h2><p data-op-id="7">40€</p></section>',
};

const deps = {
  antesTagged: ANTES,
  despuesTagged: DESPUES,
  outlineDe: (t: string) => (t === ANTES ? OUTLINE_ANTES : OUTLINE_DESPUES),
  seccionDe: (_t: string, id: string) => SECCIONES[id] ?? null,
};

const op = (type: Op["type"], target: string): Op => ({ type, target });

describe("parseOutline", () => {
  it("lee el formato REAL del motor: - [id] <tag> \"encabezado\"", () => {
    expect(parseOutline('- [3] <header> "TALLER El método"')).toEqual([
      { opId: "3", etiqueta: "TALLER El método" },
    ]);
  });

  it("sin encabezado cae a la etiqueta HTML, que es lo que enseña el motor", () => {
    expect(parseOutline('- [2] <div> ""')).toEqual([{ opId: "2", etiqueta: "div" }]);
    expect(parseOutline("- [2] <div>")).toEqual([{ opId: "2", etiqueta: "div" }]);
  });

  it("una línea que no es del outline se ignora, y null no rompe nada", () => {
    expect(parseOutline("cualquier cosa")).toEqual([]);
    expect(parseOutline(null)).toEqual([]);
  });
});

describe("describirOps", () => {
  it("resuelve el op-id de un DESCENDIENTE a su sección de primer nivel", () => {
    // `7` es el <p> de dentro de Precios, no la sección: el usuario tiene que
    // leer «Precios», no «p».
    const r = describirOps({ ...deps, ops: [op("replace", "7")] });
    expect(r).toEqual([{ tipo: "replace", donde: "documento", etiqueta: "Precios", indice: 2 }]);
  });

  it("el índice es el del documento de DESPUÉS, no el de antes", () => {
    // Precios estaba en la posición 1 y una sección nueva la empujó a la 2.
    // Mandar al usuario a la 1 lo llevaría a la sección equivocada.
    expect(describirOps({ ...deps, ops: [op("replace", "6")] })[0].indice).toBe(2);
  });

  it("un delete no lleva a ninguna parte: la sección ya no está", () => {
    expect(describirOps({ ...deps, ops: [op("delete", "5")] })[0]).toEqual({
      tipo: "delete",
      donde: "documento",
      etiqueta: "Precios",
      indice: -1,
    });
  });

  it("VE lo que el diff de HTML no puede ver: estilos, cabecera y comportamiento", () => {
    const r = describirOps({
      ...deps,
      ops: [op("replace", "styles"), op("replace", "head"), op("replace", "runtime")],
    });
    expect(r.map((x) => x.donde)).toEqual(["estilos", "cabecera", "comportamiento"]);
    expect(r.every((x) => x.indice === -1 && x.etiqueta === "")).toBe(true);
  });

  it("no paga una sola llamada nativa cuando el turno sólo tocó los estilos", () => {
    const outlineDe = vi.fn(() => OUTLINE_ANTES);
    const seccionDe = vi.fn(() => null);
    describirOps({ ...deps, outlineDe, seccionDe, ops: [op("replace", "styles")] });
    expect(outlineDe).not.toHaveBeenCalled();
    expect(seccionDe).not.toHaveBeenCalled();
  });

  it("una pasada por SECCIÓN, no una por op — ocho ops no cuestan ocho recorridos", () => {
    const seccionDe = vi.fn((_t: string, id: string) => SECCIONES[id] ?? null);
    describirOps({
      ...deps,
      seccionDe,
      ops: [op("replace", "2"), op("replace", "6"), op("replace", "7")],
    });
    expect(seccionDe).toHaveBeenCalledTimes(2); // dos secciones en el outline
  });

  // ⚰️ AQUÍ SE EXIGÍA LO CONTRARIO: «`attrs` no se cuenta — la emite el taller
  // para re-tintar, no el modelo». Era cierto hasta el 2026-09-02, cuando
  // `attrs` entró en el vocabulario del Agente. Dejar la prueba habría sujetado
  // un punto ciego justo en la op nueva: `secciones_tocadas` existe para que el
  // modelo compare lo que tocó con lo que le pidieron, y no habría visto ni uno
  // de estos cambios.
  it("`attrs` SÍ se cuenta desde que el modelo puede emitirla", () => {
    expect(describirOps({ ...deps, ops: [{ type: "attrs", target: "6", attrs: [] }] })).toEqual([
      { tipo: "attrs", donde: "documento", etiqueta: "Precios", indice: 2 },
    ]);
  });

  it("un op-id que no cae en ninguna sección sale sin nombre, no inventado", () => {
    const r = describirOps({ ...deps, ops: [op("replace", "999")] });
    expect(r).toEqual([{ tipo: "replace", donde: "documento", etiqueta: "", indice: -1 }]);
  });

  // 🔴 REGRESIÓN. Lo cazó la verificación contra el MOTOR REAL, no estas
  // pruebas: con el outline servido a mano la etiqueta se mantenía, y en la
  // realidad el caso NORMAL es que la op reescriba justo el encabezado que da
  // nombre a la sección. Sin esto, el «ver» no se ofrecía nunca en la edición
  // más corriente que hay.
  it("encuentra la sección aunque la op haya cambiado el encabezado que la nombra", () => {
    const outlineDespues = ['- [1] <header> "Taller El Norte"', '- [5] <section> "Titular nuevo"'].join("\n");
    const r = describirOps({
      ...deps,
      despuesTagged: "<otro/>",
      outlineDe: (t) => (t === ANTES ? OUTLINE_ANTES : outlineDespues),
      ops: [op("replace", "6")],
    });
    // La etiqueta es la de ANTES (es lo que el usuario reconoce), y el índice
    // sale de la posición porque el número de secciones no cambió.
    expect(r[0]).toEqual({ tipo: "replace", donde: "documento", etiqueta: "Precios", indice: 1 });
  });

  it("si la estructura CAMBIÓ y la etiqueta ya no casa, prefiere no ofrecer el «ver»", () => {
    // Mandar al usuario a la sección equivocada es peor que no mandarlo.
    const outlineDespues = [
      '- [1] <header> "Taller"',
      '- [4] <section> "Nueva"',
      '- [5] <section> "Otro titular"',
    ].join("\n");
    const r = describirOps({
      ...deps,
      despuesTagged: "<otro/>",
      outlineDe: (t) => (t === ANTES ? OUTLINE_ANTES : outlineDespues),
      ops: [op("replace", "6")],
    });
    expect(r[0].indice).toBe(-1);
  });

  it("conserva el ORDEN en que el modelo las pidió — así se lee la historia del turno", () => {
    const r = describirOps({
      ...deps,
      ops: [op("replace", "styles"), op("delete", "5"), op("insert_after", "2")],
    });
    expect(r.map((x) => x.tipo)).toEqual(["replace", "delete", "insert_after"]);
  });
});
