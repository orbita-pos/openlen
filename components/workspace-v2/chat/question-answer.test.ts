// CONTESTAR A LEN DESDE LA TARJETA (pieza 3 de Len 2.5): dentro del turno si
// todavía espera, o como un mensaje normal que abre el siguiente.
import { describe, expect, it } from "vitest";
import { composeAnswerMessage, outcomeOfResponder } from "./question-answer";

const plazo = { id: "plazo", question: "¿Cuánto tarda la entrega?" };
const envio = { id: "envio", question: "¿Envías a todo el país?" };

describe("composeAnswerMessage", () => {
  it("una pregunta: lo elegido, sin el «(Recommended)» del modelo", () => {
    expect(composeAnswerMessage([plazo], [{ id: "plazo", selected: ["48 horas (Recommended)"] }])).toBe("48 horas");
  });

  it("varias elegidas y lo escrito, juntos", () => {
    expect(composeAnswerMessage([plazo], [{ id: "plazo", selected: ["48 horas", "Una semana"], custom: "según la zona" }])).toBe(
      "48 horas, Una semana, según la zona",
    );
  });

  it("varias preguntas: cada respuesta con su pregunta, una por línea", () => {
    expect(
      composeAnswerMessage([plazo, envio], [
        { id: "plazo", selected: ["48 horas"] },
        { id: "envio", selected: ["Sí"] },
      ]),
    ).toBe("¿Cuánto tarda la entrega? 48 horas\n¿Envías a todo el país? Sí");
  });
});

describe("outcomeOfResponder", () => {
  it("200: contestada dentro del turno", () => {
    expect(outcomeOfResponder(200, undefined)).toBe("answered");
  });
  it("🔴 409 ya_respondida (doble clic, otra pestaña): no se hace nada más", () => {
    expect(outcomeOfResponder(409, "ya_respondida")).toBe("ignore");
  });
  it("🔴 nadie espera ya (venció, o el turno cerró): va como mensaje normal", () => {
    expect(outcomeOfResponder(409, "sin_pregunta")).toBe("fallback");
    expect(outcomeOfResponder(404, "turno_no_encontrado")).toBe("fallback");
  });
  it("una forma que el servidor no acepta o un fallo suyo también caen al mensaje: la respuesta no se pierde", () => {
    expect(outcomeOfResponder(400, "respuesta_invalida")).toBe("fallback");
    expect(outcomeOfResponder(500, undefined)).toBe("fallback");
  });
});
