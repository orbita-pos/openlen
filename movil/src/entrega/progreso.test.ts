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
  // Incidente real del 31/10: un `ls tests` sin pruebas salió con código 2, Len siguió y arregló la página, y el
  // teléfono le decía al dueño «This step needs attention».
  it("un fallo del que Len siguió, sin motivo para el dueño, no pide atención ni pasa por completado", () => {
    const pasos = pasosDelTrabajo([
      { tool: "Read", status: "done", summary: "" },
      { tool: "bash", status: "error", summary: "" },
      { tool: "Edit", status: "done", summary: "" },
    ]);
    expect(pasos.some((p) => p.estado === "error" || p.estado === "warning")).toBe(false);
    expect(pasos).toHaveLength(2);
  });
  it("un fallo con motivo para el dueño sigue pidiendo atención aunque Len siguiera", () => {
    const pasos = pasosDelTrabajo([
      { tool: "Edit", status: "error", summary: "", ownerReason: { code: "site_page_limit", limit: 20 } },
      { tool: "Read", status: "done", summary: "" },
    ]);
    expect(pasos.filter((p) => p.estado === "error")).toHaveLength(1);
  });
  it("con lista de tareas, tampoco añade el fallo del que Len siguió", () => {
    const pasos = pasosDelTrabajo([
      { tool: "todo_write", status: "done", summary: "", todos: [{ content: "Arreglar el menú", status: "completed" }] },
      { tool: "bash", status: "error", summary: "" },
      { tool: "Edit", status: "done", summary: "" },
    ]);
    expect(pasos).toEqual([{ texto: "Arreglar el menú", estado: "done" }]);
  });
});
