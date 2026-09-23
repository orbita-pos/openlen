import { describe, expect, it } from "vitest";
import { ListaDeTareas } from "./lista-de-tareas";

describe("la lista de tareas, con estado y medida", () => {
  it("🔴 con estados, la que falta se nombra: A y C hechas, B no", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "A" }, { texto: "B" }, { texto: "C" }]);
    l.declarar([{ texto: "A", estado: "en_curso" }, { texto: "B" }, { texto: "C" }]);
    l.anotarCambio();
    l.declarar([{ texto: "A", estado: "hecha" }, { texto: "B" }, { texto: "C", estado: "en_curso" }]);
    l.anotarCambio();
    l.declarar([{ texto: "A", estado: "hecha" }, { texto: "B" }, { texto: "C", estado: "hecha" }]);
    expect(l.pendientes()).toEqual({ faltan: true, nombradas: ["B"], todas: ["A", "B", "C"] });
  });

  it("🔴 marcar hecha una tarea sin nada detrás no se acepta, y se dice cuál", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "titular", estado: "en_curso" }, { texto: "teléfono" }]);
    l.anotarCambio();
    const r = l.declarar([{ texto: "titular", estado: "hecha" }, { texto: "teléfono", estado: "hecha" }]);
    expect(r.sinEvidencia).toEqual(["teléfono"]);
    expect(r.tareas).toEqual([
      { tarea: "titular", estado: "hecha" },
      { tarea: "teléfono", estado: "pendiente" },
    ]);
  });

  it("🔴 una tarea de COMPROBAR se da por hecha con una lectura", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "contador", estado: "en_curso" }, { texto: "probar que sube", comprobar: true }]);
    l.anotarCambio();
    l.declarar([{ texto: "contador", estado: "hecha" }, { texto: "probar que sube", estado: "en_curso" }]);
    l.anotarLectura();
    const r = l.declarar([{ texto: "contador", estado: "hecha" }, { texto: "probar que sube", estado: "hecha" }]);
    expect(r.sinEvidencia).toEqual([]);
    expect(l.pendientes().faltan).toBe(false);
  });

  // 🔴 Revisión pre-deploy del 2026-09-22. Una sola llamada hace a menudo el
  // trabajo de dos tareas —`editar_html` junta varias ops—, y el cambio cuenta
  // sólo para la que estaba en curso. La otra no tenía forma de probarse: se
  // rechazaba, el reclamo del cierre la nombraba como pendiente, y en la
  // batería el modelo acabó explicándole al dueño la contabilidad (C07).
  // Comprobarla en la página, con ella en curso, es la salida.
  it("🔴 la que hizo la misma llamada que otra se confirma leyendo, con ella en curso", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "titular", estado: "en_curso" }, { texto: "teléfono" }]);
    l.anotarCambio(); // un editar_html que puso el titular Y el teléfono
    expect(
      l.declarar([{ texto: "titular", estado: "hecha" }, { texto: "teléfono", estado: "hecha" }]).sinEvidencia,
    ).toEqual(["teléfono"]);
    l.declarar([{ texto: "titular", estado: "hecha" }, { texto: "teléfono", estado: "en_curso" }]);
    l.anotarLectura(); // buscar_en_pagina: el teléfono está
    const r = l.declarar([{ texto: "titular", estado: "hecha" }, { texto: "teléfono", estado: "hecha" }]);
    expect(r.sinEvidencia).toEqual([]);
    expect(l.pendientes().faltan).toBe(false);
  });

  it("BRAZO DE CONTROL: una lectura NO vale para una tarea que pide un cambio", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "titular", estado: "en_curso" }]);
    l.anotarLectura();
    expect(l.declarar([{ texto: "titular", estado: "hecha" }]).sinEvidencia).toEqual(["titular"]);
  });

  it("sin estados sólo se cuenta, y no se nombra ninguna", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "A" }, { texto: "B" }, { texto: "C" }]);
    l.anotarCambio();
    l.anotarCambio();
    expect(l.pendientes()).toEqual({ faltan: true, nombradas: [], todas: ["A", "B", "C"] });
    l.anotarCambio();
    expect(l.pendientes().faltan).toBe(false);
  });

  it("sin estados, una tarea de comprobar no pide cambio", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "contador" }, { texto: "probarlo", comprobar: true }]);
    l.anotarCambio();
    expect(l.pendientes().faltan).toBe(false);
  });

  it("los cambios hechos sin tarea en curso cubren las que se marcan hechas si la cuenta cuadra", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "A" }, { texto: "B" }]);
    l.anotarCambio();
    l.anotarCambio();
    expect(l.declarar([{ texto: "A", estado: "hecha" }, { texto: "B", estado: "hecha" }]).sinEvidencia).toEqual([]);
  });

  it("…y si no cuadra no se acepta NINGUNA: no se sabe cuál es la que falta", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "A" }, { texto: "B" }]);
    l.anotarCambio();
    expect(l.declarar([{ texto: "A", estado: "hecha" }, { texto: "B", estado: "hecha" }]).sinEvidencia).toEqual([
      "A",
      "B",
    ]);
  });

  it("volver a mandar la lista conserva lo medido de cada tarea por su texto", () => {
    const l = new ListaDeTareas();
    l.declarar([{ texto: "Titular", estado: "en_curso" }]);
    l.anotarCambio();
    // Mismo texto, otra capitalización y otro orden.
    const r = l.declarar([{ texto: "botón" }, { texto: "titular", estado: "hecha" }]);
    expect(r.sinEvidencia).toEqual([]);
  });
});
