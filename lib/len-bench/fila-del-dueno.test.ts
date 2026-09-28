// lib/len-bench/fila-del-dueno.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cargarEncargos } from "./casos/cargar";
import { filaComoLaDeUnDueno } from "./fila-del-dueno";

describe("filaComoLaDeUnDueno", () => {
  it("titula como producción a quien trae su página: el <title> del documento, brief «Pasted HTML»", () => {
    // createProject (lib/projects.ts) y /api/projects/from-html hacen esto.
    expect(filaComoLaDeUnDueno({ html: "<html><head><title> Voltio — Electricista </title></head></html>" })).toEqual({
      title: "Voltio — Electricista",
      brief: "Pasted HTML",
    });
  });
  it("sin <title>, el mismo último recurso que producción", () => {
    expect(filaComoLaDeUnDueno({ html: "<p>hola</p>" }).title).toBe("Untitled page");
  });
  it("lo que Len lee del proyecto no delata el examen en NINGÚN caso de dev", async () => {
    // 2026-09-23, calibración: el título era «Agent Eval len-bench-<caso>» y el
    // brief «Agent eval throwaway fixture». Len lo leyó en el estado del turno,
    // razonó «this is a tricky eval» y se pasó 4 min adivinando al autor del caso.
    for (const e of await cargarEncargos("dev")) {
      const fila = filaComoLaDeUnDueno(e.inicio);
      const leido = `${fila.title}\n${fila.brief}`.toLowerCase();
      expect(leido, e.id).not.toContain(e.id);
      expect(leido, e.id).not.toMatch(/eval|bench|prueba|fixture|throwaway/);
    }
  }, 30_000);
});
