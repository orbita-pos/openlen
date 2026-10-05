// LO QUE EL SERVIDOR ACEPTA DEL HISTORIAL DEL NAVEGADOR: sólo nombres del
// catálogo de hoy. Pieza 3 de Len 2.5: `preguntar` pasó a llamarse
// ask_user_question, y una conversación vieja no puede perder esas llamadas.
import { describe, expect, it } from "vitest";
import { sanearHistorial } from "./historial-saneado";

const validos = new Set(["Read", "Edit", "ask_user_question"]);

describe("sanearHistorial", () => {
  it("una llamada y su respuesta `preguntar` llegan con el nombre nuevo", () => {
    const h = sanearHistorial(
      [
        { role: "user", content: "publícala" },
        { role: "assistant", content: "Antes de publicar, una cosa.", functionCalls: [{ name: "preguntar", args: { texto: "¿Qué dirección?" } }] },
        { role: "user", content: "", functionResponses: [{ name: "preguntar", response: { ok: true, resumen: "preguntó" } }] },
        { role: "user", content: "tacos-len" },
      ],
      validos,
    );
    expect(h[1]!.functionCalls).toEqual([{ name: "ask_user_question", args: {} }]);
    expect(h[2]!.functionResponses).toEqual([{ name: "ask_user_question", response: { ok: true, resumen: "preguntó" } }]);
  });

  it("un nombre que no existe ni existió se sigue descartando (brazo de control)", () => {
    const h = sanearHistorial(
      [
        { role: "assistant", content: "x", functionCalls: [{ name: "inventada", args: {} }] },
      ],
      validos,
    );
    expect(h[0]!.functionCalls).toBeUndefined();
  });
});
