import { describe, expect, it } from "vitest";
import { ejecutarGlob } from "./glob";

// El contrato de Glob de Claude Code: ver plans/len-2/ficheros-plan.md §A.

function sitio(rutas: string[], recientes?: string[]) {
  return { contenido: () => "x", ficheros: rutas, ...(recientes ? { recientes } : {}) };
}

const SITIO = sitio(["/index.html", "/contacto/index.html", "/menu/index.html"]);

describe("Glob", () => {
  it("**/*.html: todas las páginas, con rutas relativas a la raíz", () => {
    expect(ejecutarGlob({ pattern: "**/*.html" }, SITIO).texto).toBe("contacto/index.html\nindex.html\nmenu/index.html");
  });

  it("*.html: sólo lo que cuelga de la raíz", () => {
    expect(ejecutarGlob({ pattern: "*.html" }, SITIO).texto).toBe("index.html");
  });

  it("con path, relativo a esa carpeta", () => {
    expect(ejecutarGlob({ pattern: "*", path: "/menu" }, SITIO).texto).toBe("menu/index.html");
  });

  it("un patrón absoluto", () => {
    expect(ejecutarGlob({ pattern: "/contacto/*.html" }, SITIO).texto).toBe("contacto/index.html");
  });

  it("nada: «No files found»", () => {
    expect(ejecutarGlob({ pattern: "**/*.css" }, SITIO).texto).toBe("No file matches that pattern.");
  });

  it("carpeta que no existe", () => {
    expect(ejecutarGlob({ pattern: "*", path: "/nosotros" }, SITIO).error).toBe(
      "There is no folder /nosotros. Paths start at the site root, /.",
    );
  });

  it("un fichero no es una carpeta", () => {
    expect(ejecutarGlob({ pattern: "*", path: "/index.html" }, SITIO).error).toBe("/index.html is a file, not a folder: pass a folder as path, or leave path out.");
  });

  it("lo escrito en este turno primero (Claude Code ordena por fecha)", () => {
    expect(ejecutarGlob({ pattern: "**/*.html" }, sitio(["/index.html", "/menu/index.html"], ["/menu/index.html"])).texto).toBe(
      "menu/index.html\nindex.html",
    );
  });

  it("más de 100: los primeros y el aviso de cuántos faltan", () => {
    const muchas = ["/index.html", ...Array.from({ length: 120 }, (_, i) => `/p${String(i).padStart(3, "0")}/index.html`)];
    const lineas = ejecutarGlob({ pattern: "**/*.html" }, sitio(muchas)).texto.split("\n");
    expect(lineas).toHaveLength(101);
    expect(lineas[100]).toBe(
      "(100 of 121 matching files shown; 21 left out. Use a narrower pattern or path to see them.)",
    );
  });
});
