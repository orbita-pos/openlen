import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";

// OJO: el catálogo NO es un array exportado — es una función que lo construye a
// partir del entorno. Un plan que asumiera `AGENT_TOOLS` fallaría en el import.
const TOOLS = buildFunctionDeclarations({}) as {
  name: string;
  description: string;
  parameters?: { properties?: Record<string, unknown>; required?: string[] };
}[];

const nombres = () => TOOLS.map((t) => t.name);

// H3 (2026-09-25): cada almacén es el fichero /datos/<almacén>.json y se
// escribe con Edit/Write, como en Claude Code, donde no hay una herramienta para
// «guardar un dato». Lo que estas pruebas pedían a las descripciones de
// guardar_dato y editar_dato lo tiene que decir ahora la sección del prompt.
const ALMACENES = (() => {
  const p = buildAgentSystemPrompt();
  return p.slice(p.indexOf("ALMACENES (los datos de la página, en /datos)")).split("\n\n")[0];
})();

describe("el Agente sabe escribir en los almacenes", () => {
  it.each(["guardar_dato", "editar_dato", "quitar_dato", "leer_estado"])("ya no declara %s: son ficheros", (n) => {
    expect(nombres()).not.toContain(n);
  });

  it("Edit y Write, que son los que escriben el fichero, están declaradas", () => {
    expect(nombres()).toEqual(expect.arrayContaining(["Read", "Edit", "Write"]));
  });

  // El Agente tiene que saber que los almacenes se DECLARAN editando la página.
  // Sin esta frase escribiría /datos/<nuevo>.json, recibiría «not declared», y
  // no sabría qué hacer.
  it("el prompt dice cómo nace un almacén", () => {
    expect(ALMACENES).toMatch(/DECLARA/);
    expect(ALMACENES).toContain("data-ol-stores");
  });

  // Y de dónde salen los ids: una fila que se cambia conserva el suyo, y sin él
  // el Agente añadiría una fila nueva cada vez que le piden cambiar un precio.
  it("el prompt dice dónde están las filas y qué hace el id", () => {
    expect(ALMACENES).toContain("/datos/<almacén>.json");
    expect(ALMACENES).toMatch(/sin id es nueva/);
  });
});
