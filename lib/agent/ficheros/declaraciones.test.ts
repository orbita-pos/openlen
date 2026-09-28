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
  it("las descripciones dicen las reglas de uso de cada herramienta", () => {
    const edit = porNombre("Edit").description;
    expect(edit).toContain("You MUST Read the file");
    expect(edit).toContain("leave out the number and the tab at the start of each line");
    expect(edit).toContain("replace_all");
    expect(porNombre("Read").description).toContain("each line starts with its number (counting from 1) and a tab");
    expect(porNombre("Read").description).toContain("offset is the first line to return");
    expect(porNombre("Write").description).toContain("use Edit");
    expect(porNombre("Glob").description).toContain("the most recently changed first");
    expect(porNombre("Grep").description).toContain("JavaScript");
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
