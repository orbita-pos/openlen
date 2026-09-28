import { describe, expect, it } from "vitest";
import {
  AVISO_DIFERIDAS,
  NINGUNA_DIFERIDA,
  avisoDeDiferidas,
  bloqueDeFunciones,
  buscarDiferidas,
  errorDeNoCargada,
} from "./tool-search";

const decl = (name: string, description: string) => ({
  name,
  description,
  parameters: { type: "OBJECT", properties: { x: { type: "STRING" } } },
});
const DIFERIDAS = [
  decl("activar_modulo", "Enciende un módulo de la página: el chat privado o el asistente."),
  decl("editar_imagen", "Edita una imagen de la página con IA: quitar el fondo, cambiar la luz."),
  decl("preparar_marketing", "Prepara textos para redes a partir de la página."),
  decl("revertir_ultimo_cambio", "Deshace TU último cambio guardado en una página."),
];

describe("ToolSearch — las herramientas diferidas, como Claude Code", () => {
  it("select: trae ésas, por su nombre exacto y en el orden pedido", () => {
    const r = buscarDiferidas("select:editar_imagen,activar_modulo", 5, DIFERIDAS);
    expect(r.map((d) => d.name)).toEqual(["editar_imagen", "activar_modulo"]);
  });

  it("select: con un nombre que no es diferido no trae nada de él", () => {
    expect(buscarDiferidas("select:Read", 5, DIFERIDAS)).toEqual([]);
  });

  it("palabras sueltas: busca en nombre y descripción, las mejores primero, hasta max_results", () => {
    const r = buscarDiferidas("imagen fondo", 5, DIFERIDAS);
    expect(r[0]?.name).toBe("editar_imagen");
    expect(buscarDiferidas("página", 2, DIFERIDAS)).toHaveLength(2);
  });

  it("+palabra: exige esa palabra en el NOMBRE", () => {
    const r = buscarDiferidas("+modulo página", 5, DIFERIDAS);
    expect(r.map((d) => d.name)).toEqual(["activar_modulo"]);
  });

  it("el bloque es el de Claude Code: una <function> por línea, con description, name y parameters", () => {
    const b = bloqueDeFunciones([DIFERIDAS[0]!]);
    expect(b.startsWith("<functions>\n<function>{\"description\":")).toBe(true);
    expect(b.endsWith("</function>\n</functions>")).toBe(true);
    const json = JSON.parse(b.slice("<functions>\n<function>".length, -"</function>\n</functions>".length));
    expect(Object.keys(json)).toEqual(["description", "name", "parameters"]);
  });

  it("sin coincidencias, lo dice", () => {
    expect(NINGUNA_DIFERIDA).toBe("No deferred tool matches that query.");
  });

  it("el aviso de las diferidas es el de Claude Code, con los nombres uno por línea", () => {
    const a = avisoDeDiferidas(["activar_modulo", "editar_imagen"]);
    expect(a).toBe(`<system-reminder>\n${AVISO_DIFERIDAS}\nactivar_modulo\neditar_imagen\n</system-reminder>`);
    expect(AVISO_DIFERIDAS).toContain('Load them with ToolSearch, query "select:<name>[,<name>...]"');
  });

  it("llamar a una diferida sin cargarla falla con InputValidationError y dice cómo cargarla", () => {
    const e = errorDeNoCargada("editar_imagen");
    expect(e).toMatch(/^<tool_use_error>InputValidationError: /);
    expect(e).toContain('"select:editar_imagen"');
  });
});
