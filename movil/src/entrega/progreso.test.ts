import { describe, expect, it } from "vitest";
import { pasosDelTrabajo } from "./progreso";
describe("progreso real", () => {
  it("prefiere la última lista de tareas de Len", () => {
    expect(pasosDelTrabajo([{ tool: "todo_write", status: "done", summary: "", todos: [{ content: "Revisar el horario", status: "in_progress" }] }])).toEqual([{ texto: "Revisar el horario", estado: "running" }]);
  });
  it("conserva los fallos, sin convertirlos en completados", () => {
    expect(pasosDelTrabajo([{ tool: "Edit", status: "error", summary: "" }])).toEqual([{ clave: "cambiando", estado: "error" }]);
  });
  it("sin acciones no inventa pasos", () => expect(pasosDelTrabajo([])).toEqual([]));
});
