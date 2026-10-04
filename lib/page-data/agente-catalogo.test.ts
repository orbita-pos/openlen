import { describe, expect, it } from "vitest";
import { instruccionesDeLen, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { documentosDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { RUTA_API_D } from "@/lib/agent/ficheros/manual";

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
// Desde el 2026-10-04 la receta vive en /.openlen/docs/api-d.md, sólo para las
// páginas que ya declaran almacenes: lo nuevo va al backend de Supabase.
const ALMACENES = documentosDeLaPlataforma()[RUTA_API_D]!;

describe("el Agente sabe escribir en los almacenes", () => {
  it.each(["guardar_dato", "editar_dato", "quitar_dato", "leer_estado"])("ya no declara %s: son ficheros", (n) => {
    expect(nombres()).not.toContain(n);
  });

  it("Edit y Write, que son los que escriben el fichero, están declaradas", () => {
    expect(nombres()).toEqual(expect.arrayContaining(["Read", "Edit", "Write"]));
  });

  // En una página que ya los usa, el Agente tiene que saber que los almacenes se
  // DECLARAN editando la página. Sin esta frase escribiría /datos/<nuevo>.json,
  // recibiría «not declared», y no sabría qué hacer. El manual le dice dónde
  // leerla.
  it("el doc de data-ol-stores dice cómo nace un almacén, y el manual lo señala", () => {
    expect(instruccionesDeLen()).toContain(`${RUTA_API_D}: ONLY for a page that already declares a data-ol-stores block`);
    expect(ALMACENES).toMatch(/DECLARED/);
    expect(ALMACENES).toContain("data-ol-stores");
  });

  // Y de dónde salen los ids: una fila que se cambia conserva el suyo, y sin él
  // el Agente añadiría una fila nueva cada vez que le piden cambiar un precio.
  it("y dónde están las filas y qué hace el id", () => {
    expect(ALMACENES).toContain("/datos/<store>.json");
    expect(ALMACENES).toMatch(/without an id is new/);
  });
});
