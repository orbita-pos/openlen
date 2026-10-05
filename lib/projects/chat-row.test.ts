// LA FILA DEL CHAT AL RECARGAR (pieza 7): el modo plan vuelve con la charla.
// La consulta lee `transcript->>'planMode'` (jsonb: llega como texto) sin traer
// la transcripción entera, y la fila sólo lo lleva cuando es `"true"`.
import { describe, expect, it } from "vitest";
import { rowToTurn } from "./chat";

const fila = {
  id: "t1",
  projectId: "p1",
  userText: "añade reseñas",
  assistantReasoning: "Te propongo un plan.",
  status: "applied",
  createdAt: new Date("2026-10-05T12:00:00Z"),
} as unknown as Parameters<typeof rowToTurn>[0];

describe("rowToTurn y el modo plan", () => {
  it("la fila que cerró en modo plan lo trae", () => {
    expect(rowToTurn({ ...fila, planMode: "true" }).planMode).toBe(true);
  });

  it("sin la foto (o con otra cosa), no aparece", () => {
    expect(rowToTurn(fila)).not.toHaveProperty("planMode");
    expect(rowToTurn({ ...fila, planMode: null })).not.toHaveProperty("planMode");
    expect(rowToTurn({ ...fila, planMode: "false" })).not.toHaveProperty("planMode");
  });
});
