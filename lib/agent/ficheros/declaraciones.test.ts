import { describe, expect, it } from "vitest";
import { DECLARACIONES_DE_FICHEROS } from "./declaraciones";

// Lo que el modelo ve de las cinco herramientas: nombres y parámetros de
// Claude Code, con descripciones nuestras (plans/len-2/ficheros-plan.md §A).

type Decl = {
  name: string;
  description: string;
  parameters: { type: string; properties: Record<string, { type: string; enum?: string[] }>; required?: string[] };
};
const porNombre = (n: string) => DECLARACIONES_DE_FICHEROS.find((d) => d.name === n) as unknown as Decl;

describe("las cinco herramientas de ficheros, como Claude Code", () => {
  it("se llaman como en Claude Code", () => {
    expect(DECLARACIONES_DE_FICHEROS.map((d) => d.name)).toEqual(["Read", "Edit", "Write", "Grep", "Glob"]);
  });

  it("Read: file_path obligatorio, offset y limit", () => {
    const d = porNombre("Read");
    expect(Object.keys(d.parameters.properties)).toEqual(["file_path", "offset", "limit"]);
    expect(d.parameters.required).toEqual(["file_path"]);
    expect(d.parameters.properties.offset!.type).toBe("NUMBER");
  });

  it("Edit: file_path, old_string, new_string y replace_all", () => {
    const d = porNombre("Edit");
    expect(Object.keys(d.parameters.properties)).toEqual(["file_path", "old_string", "new_string", "replace_all"]);
    expect(d.parameters.required).toEqual(["file_path", "old_string", "new_string"]);
    expect(d.parameters.properties.replace_all!.type).toBe("BOOLEAN");
  });

  it("Write: file_path y content", () => {
    const d = porNombre("Write");
    expect(Object.keys(d.parameters.properties)).toEqual(["file_path", "content"]);
    expect(d.parameters.required).toEqual(["file_path", "content"]);
  });

  it("Grep: los parámetros de ripgrep, output_mode con sus tres valores", () => {
    const d = porNombre("Grep");
    expect(Object.keys(d.parameters.properties)).toEqual([
      "pattern", "path", "glob", "output_mode", "-B", "-A", "-C", "context", "-n", "-i", "-o", "type", "head_limit", "offset", "multiline",
    ]);
    expect(d.parameters.properties.output_mode!.enum).toEqual(["content", "files_with_matches", "count"]);
    expect(d.parameters.required).toEqual(["pattern"]);
  });

  it("Glob: pattern y path", () => {
    const d = porNombre("Glob");
    expect(Object.keys(d.parameters.properties)).toEqual(["pattern", "path"]);
    expect(d.parameters.required).toEqual(["pattern"]);
  });

  // Los textos son NUESTROS desde el 2026-09-27 (el repo es público): lo que se
  // exige es que digan las reglas de uso, no una redacción concreta.
  // F4 (plans/len-agente-2026): la forma de DeepSeek, la herramienta en una o
  // dos frases y el detalle en sus parámetros. Lo que se exige es que la regla
  // esté en lo que el modelo lee de la herramienta, sea la descripción o un
  // parámetro (tabla regla por regla: notas/f4-tabla-de-reglas.md).
  it("las descripciones dicen las reglas de uso de cada herramienta", () => {
    const lee = (n: string) => JSON.stringify(porNombre(n));
    // E1: leer antes, con su peso, en la descripción misma.
    expect(porNombre("Edit").description).toContain("Read the file in this conversation first");
    expect(porNombre("Edit").description).toContain("is refused");
    // E2–E4: carácter a carácter, NUNCA el número de línea, y una sola vez o replace_all.
    expect(lee("Edit")).toContain("character for character");
    expect(lee("Edit")).toContain("never with the line number and tab that Read puts before each line");
    expect(lee("Edit")).toContain("unless replace_all is true");
    expect(porNombre("Read").description).toContain("numbered lines");
    expect(lee("Read")).toContain("First line to return, counting from 1");
    // W2–W3: leer antes de reemplazar, y lo parcial con Edit.
    expect(porNombre("Write").description).toContain("change part of a page with Edit");
    expect(porNombre("Write").description).toContain("has to be read in this conversation first");
    expect(porNombre("Glob").description).toContain("most recently changed first");
    expect(lee("Glob")).toContain("never send");
    expect(porNombre("Grep").description).toContain("JavaScript");
  });

  it("F4 · cada descripción cabe en tres frases, como las de DeepSeek", () => {
    for (const d of DECLARACIONES_DE_FICHEROS) {
      const frases = String(d.description).split(/(?<=[.:;])\s+(?=[A-Z])/).length;
      expect(frases, String(d.name)).toBeLessThanOrEqual(3);
    }
  });

  it("no prometen lo que aquí no existe: imágenes, PDF, cuadernos, shell ni ripgrep", () => {
    const todo = DECLARACIONES_DE_FICHEROS.map((d) => d.description).join("\n");
    for (const falso of ["PDF", "Jupyter", "screenshot", "Bash", "shell tool", "built on ripgrep", "Claude Code"]) {
      expect(todo).not.toContain(falso);
    }
  });

  it("dicen cómo es este sitio: cada fichero es una página", () => {
    expect(porNombre("Write").description).toContain("/<slug>/index.html");
  });
});
