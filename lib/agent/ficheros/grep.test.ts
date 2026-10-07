import { describe, expect, it } from "vitest";
import { ejecutarGrep } from "./grep";

// El contrato de Grep de Claude Code: ver plans/len-2/ficheros-plan.md §A.
// Sin ripgrep: RegExp de JS sobre los ficheros del sitio (decisión B5).

const FICHEROS: Record<string, string> = {
  "/index.html": "<h1>Taller Río</h1>\n<p>Llámanos: 55 1234 5678</p>\n<footer>55 1234 5678</footer>",
  "/menu/index.html": "<h1>Menú</h1>\n<p>Tacos</p>",
  "/contacto/index.html": "<p>Tel 55 1234 5678</p>",
};

function sitio(ficheros = FICHEROS) {
  return { contenido: (ruta: string) => ficheros[ruta] ?? null, ficheros: Object.keys(ficheros) };
}

describe("Grep", () => {
  it("por defecto lista los ficheros que casan, con rutas relativas a la raíz", () => {
    expect(ejecutarGrep({ pattern: "55 1234" }, sitio()).texto).toBe(
      "2 matching files\ncontacto/index.html\nindex.html",
    );
  });

  it("uno solo: «Found 1 file»", () => {
    expect(ejecutarGrep({ pattern: "Tacos" }, sitio()).texto).toBe("1 matching file\nmenu/index.html");
  });

  it("nada: «No files found»", () => {
    expect(ejecutarGrep({ pattern: "WhatsApp" }, sitio()).texto).toBe("No file matches.");
  });

  it("content: ruta:línea:texto, con los números de línea por defecto", () => {
    expect(ejecutarGrep({ pattern: "55 1234", output_mode: "content" }, sitio()).texto).toBe(
      "contacto/index.html:1:<p>Tel 55 1234 5678</p>\nindex.html:2:<p>Llámanos: 55 1234 5678</p>\nindex.html:3:<footer>55 1234 5678</footer>",
    );
  });

  it("content con -n false quita el número", () => {
    expect(ejecutarGrep({ pattern: "Tacos", output_mode: "content", "-n": false }, sitio()).texto).toBe(
      "menu/index.html:<p>Tacos</p>",
    );
  });

  it("content sobre UN fichero va sin ruta", () => {
    expect(ejecutarGrep({ pattern: "h1", output_mode: "content", path: "/menu/index.html" }, sitio()).texto).toBe(
      "1:<h1>Menú</h1>",
    );
  });

  it("contexto: las líneas de alrededor con guion, y -- entre bloques separados", () => {
    const ficheros = { "/index.html": "a\nX\nb\nc\nd\nX\ne" };
    expect(ejecutarGrep({ pattern: "X", output_mode: "content", "-C": 1 }, sitio(ficheros)).texto).toBe(
      "index.html-1-a\nindex.html:2:X\nindex.html-3-b\n--\nindex.html-5-d\nindex.html:6:X\nindex.html-7-e",
    );
  });

  it("una línea de más de 500 caracteres no se enseña: se dice que se omitió", () => {
    const ficheros = { "/index.html": `<style>${"a".repeat(600)} .x{}</style>\n<p class="x">hola</p>` };
    expect(ejecutarGrep({ pattern: "x", output_mode: "content" }, sitio(ficheros)).texto).toBe(
      "index.html:1:[matching line too long to show]\nindex.html:2:<p class=\"x\">hola</p>",
    );
  });

  it("-i no distingue mayúsculas", () => {
    expect(ejecutarGrep({ pattern: "taller", "-i": true }, sitio()).texto).toBe("1 matching file\nindex.html");
  });

  it("-o da sólo lo que casa", () => {
    expect(ejecutarGrep({ pattern: "55 \\d+", output_mode: "content", "-o": true, path: "/index.html" }, sitio()).texto).toBe(
      "2:55 1234\n3:55 1234",
    );
  });

  it("multiline deja que el patrón cruce líneas", () => {
    expect(ejecutarGrep({ pattern: "Menú</h1>.<p>", multiline: true }, sitio()).texto).toBe("1 matching file\nmenu/index.html");
  });

  it("count: ruta:líneas y el total", () => {
    expect(ejecutarGrep({ pattern: "55 1234", output_mode: "count" }, sitio()).texto).toBe(
      "contacto/index.html:1\nindex.html:2\n\n3 matches in 2 files.",
    );
  });

  it("count sin nada", () => {
    expect(ejecutarGrep({ pattern: "zzz", output_mode: "count" }, sitio()).texto).toBe(
      "No line matches.\n\n0 matches in 0 files.",
    );
  });

  it("head_limit corta y lo dice; offset pagina", () => {
    expect(ejecutarGrep({ pattern: "<", output_mode: "content", head_limit: 2 }, sitio()).texto).toBe(
      "contacto/index.html:1:<p>Tel 55 1234 5678</p>\nindex.html:1:<h1>Taller Río</h1>\n\n[page: limit: 2]",
    );
    expect(ejecutarGrep({ pattern: "<", head_limit: 1, offset: 1 }, sitio()).texto).toBe(
      "1 matching file (limit: 1, offset: 1)\nindex.html",
    );
  });

  it("head_limit tiene que ser un entero ≥ 0", () => {
    expect(ejecutarGrep({ pattern: "a", head_limit: -1 }, sitio()).error).toBe(
      "head_limit has to be a whole number, 0 or more (got -1). 0 means no limit.",
    );
  });

  it("glob filtra ficheros", () => {
    expect(ejecutarGrep({ pattern: "55", glob: "contacto/*" }, sitio()).texto).toBe("1 matching file\ncontacto/index.html");
  });

  it("path a una carpeta busca dentro", () => {
    expect(ejecutarGrep({ pattern: "<", path: "/menu" }, sitio()).texto).toBe("1 matching file\nmenu/index.html");
  });

  it("path que no existe: lo dice, con la raíz del sitio", () => {
    expect(ejecutarGrep({ pattern: "a", path: "/nosotros" }, sitio()).error).toBe(
      "There is no file or folder /nosotros. Paths start at the site root, /.",
    );
  });

  it("lo escrito en este turno sale primero (Claude Code ordena por fecha)", () => {
    const r = ejecutarGrep({ pattern: "55 1234" }, { ...sitio(), recientes: ["/index.html"] });
    expect(r.texto).toBe("2 matching files\nindex.html\ncontacto/index.html");
  });

  it("una expresión que no compila se dice, no revienta", () => {
    expect(ejecutarGrep({ pattern: "(" }, sitio()).ok).toBe(false);
  });

  it("un resultado de más de 20.000 caracteres se corta y dice cómo ver el resto", () => {
    const ficheros = { "/index.html": Array.from({ length: 300 }, (_, i) => `<p>${i} ${"x".repeat(100)}</p>`).join("\n") };
    const r = ejecutarGrep({ pattern: "<p>", output_mode: "content" }, sitio(ficheros));
    expect(r.texto.length).toBeLessThan(20_300);
    expect(r.texto).toMatch(/\n\n\[Result cut: the first \d+(\.\d)?KB of \d+(\.\d)?KB\. Page through the rest with head_limit and offset, or narrow the pattern\.\]$/);
  });
});

// ⚰️ «type» decía que todo el sitio era HTML: `type: "js"` no encontraba nada,
// tampoco el código de una app (F3 de las apps web). Ahora, por extensión.
describe("Grep · type, por extensión como rg --type", () => {
  const CON_CODIGO = {
    "/index.html": "<div id=root></div><!-- precio -->",
    "/src/App.jsx": "const precio = 1;",
    "/src/util.ts": "export const precio = 2;",
    "/css/a.css": ".precio{}",
  };
  it("js incluye .jsx, ts incluye .tsx/.ts, html sólo las páginas", () => {
    expect(ejecutarGrep({ pattern: "precio", type: "js" }, sitio(CON_CODIGO)).texto).toBe("1 matching file\nsrc/App.jsx");
    expect(ejecutarGrep({ pattern: "precio", type: "ts" }, sitio(CON_CODIGO)).texto).toBe("1 matching file\nsrc/util.ts");
    expect(ejecutarGrep({ pattern: "precio", type: "html" }, sitio(CON_CODIGO)).texto).toBe("1 matching file\nindex.html");
  });
  it("un tipo que no existe se dice, con los que hay", () => {
    const r = ejecutarGrep({ pattern: "precio", type: "cobol" }, sitio(CON_CODIGO));
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/unrecognized file type: cobol\. Known types: html, js, ts/);
  });
});
