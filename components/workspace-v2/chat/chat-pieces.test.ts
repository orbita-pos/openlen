// Las piezas puras del chat nuevo (plans/new-chat/): el interruptor, el ancho,
// las correcciones de tu mensaje, la pregunta que no se repite y qué cambió.
import { describe, expect, it } from "vitest";

import { clampChatWidth, readChatVersion, CHAT_WIDTH_MAX, CHAT_WIDTH_MIN, DEFAULT_CHAT_VERSION } from "./use-chat-version";
import { splitCorrections } from "./chat-turn";
import { withoutTrailingQuestion } from "./question-card";
import { editsOfTurn, turnChanges } from "./turn-changes";
import { visibleSteps } from "./steps-card";
import { withServerStatus } from "./server-status";

describe("qué chat se monta", () => {
  it("la URL manda, luego lo recordado, luego el de por defecto", () => {
    expect(readChatVersion("?chat=new", "old")).toBe("new");
    expect(readChatVersion("?chat=old", "new")).toBe("old");
    expect(readChatVersion("", "new")).toBe("new");
    expect(readChatVersion("?chat=raro", null)).toBe(DEFAULT_CHAT_VERSION);
    // Desde el 03/10 el nuevo es el de por defecto; el viejo, sólo con ?chat=old.
    expect(readChatVersion("", null)).toBe("new");
  });

  it("el ancho no se sale de sus topes", () => {
    expect(clampChatWidth(10)).toBe(CHAT_WIDTH_MIN);
    expect(clampChatWidth(9999)).toBe(CHAT_WIDTH_MAX);
    expect(clampChatWidth(Number.NaN)).toBeGreaterThanOrEqual(CHAT_WIDTH_MIN);
  });
});

describe("tu mensaje", () => {
  it("lo que corregiste a media faena sale aparte, en su orden", () => {
    expect(splitCorrections("hazla brutalista\n↳ mejor premium\n↳ y sin negro")).toEqual({
      text: "hazla brutalista",
      corrections: ["mejor premium", "y sin negro"],
    });
    expect(splitCorrections("sin correcciones")).toEqual({ text: "sin correcciones", corrections: [] });
  });
});

describe("la pregunta", () => {
  it("no se repite al final del texto si va en su tarjeta", () => {
    expect(withoutTrailingQuestion("Me falta un dato.\n\n¿Cuántas horas?", "¿Cuántas horas?")).toBe("Me falta un dato.");
    expect(withoutTrailingQuestion("Texto sin la pregunta.", "¿Cuántas horas?")).toBe("Texto sin la pregunta.");
    expect(withoutTrailingQuestion("Hola", null)).toBe("Hola");
  });

  it("la última tarjeta `preguntar` sale de los pasos; una que falló, no", () => {
    expect(
      visibleSteps([
        { tool: "Read", status: "done", summary: "a" },
        { tool: "preguntar", status: "done", summary: "" },
      ]).map((a) => a.tool),
    ).toEqual(["Read"]);
    expect(visibleSteps([{ tool: "preguntar", status: "error", summary: "" }])).toHaveLength(1);
  });
});

describe("qué cambió el turno", () => {
  it("las ops mandan, y lo que no es una sección se nombra por su sitio", () => {
    const cambios = turnChanges(
      {
        preEditHtml: "",
        actions: [
          {
            tool: "Edit",
            status: "done",
            summary: "",
            edits: 2,
            ops: [
              { tipo: "replace", donde: "documento", etiqueta: "la portada", indice: 1 },
              { tipo: "attrs", donde: "estilos", etiqueta: "", indice: -1 },
            ],
          },
        ],
      },
      (place) => `[${place}]`,
    );
    expect(cambios).toEqual([
      { tipo: "cambiada", etiqueta: "la portada", indice: 1 },
      { tipo: "cambiada", etiqueta: "[estilos]", indice: -1 },
    ]);
  });

  it("sin ops ni par antes/después no afirma nada", () => {
    expect(turnChanges({ preEditHtml: "", actions: [] }, () => "")).toEqual([]);
  });

  it("las ediciones se suman de las tarjetas", () => {
    expect(editsOfTurn({ actions: [{ tool: "Edit", status: "done", summary: "", edits: 2 }, { tool: "Edit", status: "done", summary: "", edits: 3 }] })).toBe(5);
    expect(editsOfTurn({})).toBe(0);
  });
});

describe("el estado que dice el servidor al converger", () => {
  it("toma el «reverted» de otra pestaña", () => {
    expect(withServerStatus({ id: "a", status: "applied" }, { status: "reverted" })).toEqual({ id: "a", status: "reverted" });
  });

  it("🔴 no le quita su error a un turno que aquí falló, aunque el servidor lo registrara «applied»", () => {
    const local = { id: "b", status: "error", errorText: "upstream" };
    expect(withServerStatus(local, { status: "applied" })).toBe(local);
  });
});
