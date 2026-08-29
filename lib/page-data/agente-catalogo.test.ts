import { describe, expect, it } from "vitest";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";

// OJO: el catálogo NO es un array exportado — es una función que lo construye a
// partir del entorno. Un plan que asumiera `AGENT_TOOLS` fallaría en el import.
const TOOLS = buildFunctionDeclarations({}) as {
  name: string;
  description: string;
  parameters?: { properties?: Record<string, unknown>; required?: string[] };
}[];

const nombres = () => TOOLS.map((t) => t.name);
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;

describe("el Agente sabe escribir en los almacenes", () => {
  it.each(["guardar_dato", "editar_dato", "quitar_dato"])("declara %s", (n) => {
    expect(nombres()).toContain(n);
  });

  it("guardar_dato pide el almacén y el documento", () => {
    const t = tool("guardar_dato");
    expect(Object.keys(t.parameters?.properties ?? {})).toEqual(
      expect.arrayContaining(["almacen", "datos"]),
    );
    expect(t.parameters?.required).toEqual(expect.arrayContaining(["almacen", "datos"]));
  });

  it("editar_dato y quitar_dato piden el id", () => {
    for (const n of ["editar_dato", "quitar_dato"]) {
      expect(tool(n).parameters?.required, n).toEqual(expect.arrayContaining(["id"]));
    }
  });

  // El Agente tiene que saber que los almacenes se DECLARAN editando la página,
  // no llamando a una herramienta. Sin esta frase intentará crear uno con
  // guardar_dato, recibirá `almacen_no_declarado`, y no sabrá qué hacer.
  it("la descripción dice cómo nace un almacén", () => {
    const d = tool("guardar_dato").description;
    expect(d).toMatch(/declara/i);
    expect(d).toMatch(/editar_pagina|data-ol-stores/);
  });

  // Y de dónde saca el id, o `editar_dato` es inusable: el Agente pediría un id
  // que no tiene forma de conocer.
  it("editar_dato dice de dónde viene el id", () => {
    expect(tool("editar_dato").description).toMatch(/leer_estado/);
  });
});
