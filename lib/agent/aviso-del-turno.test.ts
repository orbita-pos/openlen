import { describe, expect, it } from "vitest";

import { avisoDelTurno, MAX_AVISO, ultimoParrafo } from "./aviso-del-turno";

describe("el aviso de que Len terminó sin nadie mirando", () => {
  it("el cuerpo es lo último que dijo Len, no el turno entero", () => {
    const texto = "Voy a leer la portada.\n\nYa tengo el catálogo.\n\nListo: la tienda tiene catálogo y carrito.";
    expect(ultimoParrafo(texto)).toBe("Listo: la tienda tiene catálogo y carrito.");
  });

  it("se recorta a lo que cabe en una notificación", () => {
    const largo = "a".repeat(400);
    const r = ultimoParrafo(largo);
    expect(r.length).toBe(MAX_AVISO);
    expect(r.endsWith("…")).toBe(true);
  });

  it("los saltos de línea dentro del párrafo no llegan a la notificación", () => {
    expect(ultimoParrafo("Hice tres cosas:\n- el menú\n- el precio")).toBe("Hice tres cosas: - el menú - el precio");
  });

  it("sin texto, cuerpo vacío (el canal pone el título)", () => {
    expect(ultimoParrafo("   \n\n  ")).toBe("");
  });

  it("🔴 si terminó preguntando, el aviso lo dice: sin su respuesta Len no sigue", () => {
    const e = avisoDelTurno({
      projectId: "p1",
      userId: "u1",
      texto: "¿Cuál es tu WhatsApp?",
      tarjetas: [{ tool: "Read" }, { tool: "preguntar" }],
    });
    expect(e).toEqual({
      type: "len_turno",
      projectId: "p1",
      recipientUserId: "u1",
      preview: "¿Cuál es tu WhatsApp?",
      pregunta: true,
    });
  });

  it("pieza 3: con el nombre nuevo, igual; y una contestada DENTRO del turno ya no es «te toca»", () => {
    const base = { projectId: "p1", userId: "u1", texto: "¿Cuál es tu WhatsApp?" };
    expect(avisoDelTurno({ ...base, tarjetas: [{ tool: "ask_user_question" }] }).pregunta).toBe(true);
    expect(avisoDelTurno({ ...base, tarjetas: [{ tool: "ask_user_question", respuesta: "55 1234" }, { tool: "Edit" }] }).pregunta).toBe(false);
  });

  it("BRAZO DE CONTROL: un turno que terminó el trabajo no es una pregunta", () => {
    const e = avisoDelTurno({ projectId: "p1", userId: "u1", texto: "Listo.", tarjetas: [{ tool: "Edit" }] });
    expect(e.pregunta).toBe(false);
  });
});
