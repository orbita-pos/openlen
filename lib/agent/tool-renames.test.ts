import { describe, expect, it } from "vitest";
import { currentToolCall, currentToolName, TOOL_RENAMES } from "./tool-renames";

describe("lo guardado con los nombres de antes, con los de hoy", () => {
  it("los once, y preguntar, que ya estaba", () => {
    expect(currentToolName("mirar_pagina")).toBe("view_page");
    expect(currentToolName("preparar_respuesta")).toBe("draft_reply");
    expect(currentToolName("preguntar")).toBe("ask_user_question");
    expect(Object.keys(TOOL_RENAMES)).toHaveLength(12);
  });

  it("un nombre de hoy o desconocido pasa igual", () => {
    expect(currentToolName("view_page")).toBe("view_page");
    expect(currentToolName("Read")).toBe("Read");
  });

  it("🔴 mirar_pagina({tipo:'medir'}) vuelve como view_page({mode:'measure'})", () => {
    expect(currentToolCall({ name: "mirar_pagina", args: { tipo: "medir", pregunta: "¿desborda?", zona: "el hero", file_path: "/index.html" } })).toEqual({
      name: "view_page",
      args: { mode: "measure", question: "¿desborda?", area: "el hero", file_path: "/index.html" },
    });
  });

  it("los pasos de usar_pagina se traducen uno a uno", () => {
    expect(
      currentToolCall({
        name: "usar_pagina",
        args: { pasos: [{ pulsa: "Añadir", dentro_de: "Taco" }, { escribe: "Ana", en: "Nombre" }, { elige: "Grande" }, { recarga: true }, { lee: "Total" }] },
      }),
    ).toEqual({
      name: "use_page",
      args: { steps: [{ click: "Añadir", within: "Taco" }, { type: "Ana", into: "Nombre" }, { choose: "Grande" }, { reload: true }, { read: "Total" }] },
    });
  });

  it("los valores del enum también", () => {
    expect(currentToolCall({ name: "ver_mensajes", args: { cuales: "sin_leer" } }).args).toEqual({ which: "unread" });
    expect(currentToolCall({ name: "preparar_respuesta", args: { para: "formulario", id: "f1", texto: "Hola" } }).args).toEqual({ channel: "form", id: "f1", text: "Hola" });
  });

  it("numero, que nunca se leyó, desaparece", () => {
    expect(currentToolCall({ name: "activar_modulo", args: { modulo: "chat", encender: true, numero: "+52" } }).args).toEqual({ module: "chat", on: true });
  });

  it("preguntar conserva su traducción de forma (pieza 3)", () => {
    expect(currentToolCall({ name: "preguntar", args: { texto: "¿Azul?" } })).toEqual({
      name: "ask_user_question",
      args: { questions: [{ id: "q1", question: "¿Azul?" }] },
    });
  });

  it("una llamada de hoy no se toca", () => {
    const hoy = { name: "view_page", args: { mode: "describe", question: "x" } };
    expect(currentToolCall(hoy)).toEqual(hoy);
  });
});
