import { describe, expect, it } from "vitest";
import type { StoredChatTurn } from "@/lib/projects/types";
import { loQueDijoLen } from "./hoja";

const turno = (o: Partial<StoredChatTurn>): StoredChatTurn => ({ id: "t", userText: "", assistantReasoning: "", status: "applied", ...o });

describe("lo último que dijo Len, para la hoja", () => {
  it("el último párrafo del último turno con texto", () => {
    const r = loQueDijoLen([turno({ id: "1", assistantReasoning: "viejo" }), turno({ id: "2", assistantReasoning: "Primero.\n\nLe puse tus horarios." })]);
    expect(r).toEqual({ texto: "Le puse tus horarios.", enCurso: false, fila: "2" });
  });

  it("un turno en curso se marca, aunque aún no tenga texto", () => {
    expect(loQueDijoLen([turno({ id: "3", assistantReasoning: "", enCurso: true })])).toEqual({ texto: "", enCurso: true, fila: "3" });
  });

  it("sin historial, nada", () => {
    expect(loQueDijoLen([])).toBeNull();
  });

  it("recorta a 400 caracteres", () => {
    expect(loQueDijoLen([turno({ assistantReasoning: "x".repeat(500) })])!.texto.length).toBe(400);
  });
});
