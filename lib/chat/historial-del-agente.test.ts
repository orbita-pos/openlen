import { describe, expect, it } from "vitest";
import { MARCA_DE_TURNO_CORTADO, historialParaElAgente } from "./historial-del-agente";

describe("el historial que el taller le manda al Agente", () => {
  const turno = {
    userText: "quiero varios decks",
    assistantReasoning: "",
    status: "applied",
    actions: [{ tool: "editar_html", status: "done", summary: "sección de decks" }],
  };

  it("🔴 H05 · un turno cortado viaja con su marca, delante de las llamadas", () => {
    const { history } = historialParaElAgente([{ ...turno, cortado: true }], null);
    const asistente = history.find((h) => h.role === "assistant")!;
    expect(asistente.content).toBe(MARCA_DE_TURNO_CORTADO);
    expect(asistente.functionCalls?.map((c) => c.name)).toEqual(["editar_html"]);
  });

  it("BRAZO DE CONTROL: un turno que terminó viaja como siempre", () => {
    const { history } = historialParaElAgente([turno], null);
    expect(history.find((h) => h.role === "assistant")!.content).toBe("");
  });

  it("🔴 H08-a · lo que el dueño dijo en los turnos que se caen de la ventana viaja aparte", () => {
    const turnos = [
      { userText: "hola", status: "applied" },
      { userText: 'de ahora en adelante todos los precios con MXN y "IVA incluido"', status: "applied" },
      ...Array.from({ length: 12 }, (_, i) => ({ userText: `relleno ${i}`, status: "applied" })),
    ];
    const { dichoAntes } = historialParaElAgente(turnos, null);
    expect(dichoAntes).toEqual(["hola", 'de ahora en adelante todos los precios con MXN y "IVA incluido"']);
  });

  it("BRAZO DE CONTROL: si todo cabe, no hay nada que añadir", () => {
    expect(historialParaElAgente([turno], null).dichoAntes).toEqual([]);
  });

  it("🔴 H08-b · los valores aplicados viajan en el resumen del historial", () => {
    const { history } = historialParaElAgente(
      [{ ...turno, actions: [{ tool: "cambiar_tema", status: "done", summary: "acento morado", valores: "acento #7A3FD1" }] }],
      null,
    );
    const r = history.flatMap((h) => h.functionResponses ?? [])[0]!.response;
    expect(r.resumen).toBe("acento morado (acento #7A3FD1)");
  });

  it("la ventana es de doce turnos y `historyTotal` cuenta todos", () => {
    const muchos = Array.from({ length: 14 }, (_, i) => ({ userText: `t${i}`, status: "applied" }));
    const { history, historyTotal } = historialParaElAgente(muchos, null);
    expect(historyTotal).toBe(14);
    expect(history.filter((h) => h.role === "user").map((h) => h.content)[0]).toBe("t2");
  });
});
