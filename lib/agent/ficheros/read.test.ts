import { describe, expect, it } from "vitest";
import { ejecutarRead, formatoCatN, type Leidos } from "./read";

// El contrato de Read de Claude Code: ver plans/len-2/ficheros-plan.md §A.

function sitio(ficheros: Record<string, string>) {
  return {
    contenido: (ruta: string) => ficheros[ruta] ?? null,
    ficheros: Object.keys(ficheros),
  };
}

describe("formato cat -n", () => {
  it("es número, tabulador y la línea tal cual, sin relleno", () => {
    expect(formatoCatN("<html>\n  <body>", 1)).toBe("1\t<html>\n2\t  <body>");
  });

  it("empieza en la línea que se le diga y quita el \\r final", () => {
    expect(formatoCatN("a\r\nb", 7)).toBe("7\ta\n8\tb");
  });
});

describe("Read", () => {
  it("lee el fichero entero y lo apunta como leído", () => {
    const leidos: Leidos = new Map();
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "<h1>Hola</h1>\n<p>x</p>" }), leidos);
    expect(r).toEqual({ ok: true, texto: "1\t<h1>Hola</h1>\n2\t<p>x</p>" });
    expect(leidos.get("/index.html")).toEqual({
      instantanea: "<h1>Hola</h1>\n<p>x</p>",
      offset: 1,
      limit: undefined,
    });
  });

  it("acepta la ruta relativa y la apunta por su ruta absoluta", () => {
    const leidos: Leidos = new Map();
    ejecutarRead({ file_path: "menu/index.html" }, sitio({ "/menu/index.html": "m" }), leidos);
    expect(leidos.has("/menu/index.html")).toBe(true);
  });

  it("con offset y limit da ese tramo, numerado desde el offset", () => {
    const leidos: Leidos = new Map();
    const r = ejecutarRead(
      { file_path: "/index.html", offset: 2, limit: 2 },
      sitio({ "/index.html": "a\nb\nc\nd" }),
      leidos,
    );
    expect(r.texto).toBe("2\tb\n3\tc");
    expect(leidos.get("/index.html")).toMatchObject({ offset: 2, limit: 2 });
  });

  it("sin limit NO corta a 2.000 líneas: en el código sólo cortan los tokens y los bytes", () => {
    const largo = Array.from({ length: 2500 }, (_, i) => `l${i}`).join("\n");
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": largo }), new Map());
    expect(r.texto.split("\n")).toHaveLength(2500);
  });

  it("un fichero que no existe: lo dice, con la raíz del sitio", () => {
    const r = ejecutarRead({ file_path: "/nosotros/index.html" }, sitio({ "/index.html": "x" }), new Map());
    expect(r).toEqual({
      ok: false,
      texto: "<tool_use_error>There is no file at /nosotros/index.html. Paths start at the site root, /.</tool_use_error>",
      error: "There is no file at /nosotros/index.html. Paths start at the site root, /.",
    });
  });

  it("…y si hay uno parecido, «Did you mean»", () => {
    const r = ejecutarRead({ file_path: "/menu.html" }, sitio({ "/menu/index.html": "x" }), new Map());
    expect(r.error).toBe(
      "There is no file at /menu.html. Paths start at the site root, /. Did you mean /menu/index.html?",
    );
  });

  it("vacío: el aviso de sistema en vez del contenido", () => {
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "" }), new Map());
    expect(r.texto).toBe(
      "<system-reminder>This file exists and is empty.</system-reminder>",
    );
  });

  it("offset más allá del final: el aviso con el número de líneas", () => {
    const r = ejecutarRead({ file_path: "/index.html", offset: 50 }, sitio({ "/index.html": "a\nb" }), new Map());
    expect(r.texto).toBe(
      "<system-reminder>This file has only 2 lines, so there is nothing from line 50 on.</system-reminder>",
    );
  });

  it("releer lo mismo sin cambios es una llamada tirada", () => {
    const leidos: Leidos = new Map();
    const s = sitio({ "/index.html": "a\nb" });
    ejecutarRead({ file_path: "/index.html" }, s, leidos);
    const r = ejecutarRead({ file_path: "/index.html" }, s, leidos);
    expect(r).toEqual({
      ok: true,
      texto: "This Read was not needed: the file has not changed since your last Read of it. Use what that earlier Read returned.",
    });
  });

  it("…pero si el fichero cambió, se vuelve a leer", () => {
    const leidos: Leidos = new Map();
    ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "a" }), leidos);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "b" }), leidos);
    expect(r.texto).toBe("1\tb");
  });

  it("…y tras un Edit/Write (offset sin apuntar) también", () => {
    const leidos: Leidos = new Map([["/index.html", { instantanea: "a", offset: undefined, limit: undefined }]]);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "a" }), leidos);
    expect(r.texto).toBe("1\ta");
  });

  it("más de 256 KB sin limit: el error de tamaño de Claude Code", () => {
    const grande = "x".repeat(300 * 1024);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": grande }), new Map());
    expect(r.error).toBe(
      "This file is 300KB and a Read without limit returns at most 256KB. Read it in parts with offset and limit, or use Grep to find the part you need.",
    );
  });

  it("un tramo pedido que pasa de 25.000 tokens: el error de tokens de Claude Code", () => {
    const lineas = Array.from({ length: 1200 }, () => "y".repeat(99)).join("\n");
    const r = ejecutarRead(
      { file_path: "/index.html", offset: 1, limit: 1200 },
      sitio({ "/index.html": lineas }),
      new Map(),
    );
    expect(r.error).toBe(
      "This file is 30000 tokens long and one Read returns at most 25000. Read it in parts with offset and limit, or use Grep to find the part you need.",
    );
  });

  it("el fichero entero que no cabe se pagina solo: primera página, el cartel al final y vista parcial", () => {
    // 1.200 líneas de 99 caracteres = 119.999 caracteres ≈ 30.000 tokens.
    const lineas = Array.from({ length: 1200 }, () => "y".repeat(99)).join("\n");
    const leidos: Leidos = new Map();
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": lineas }), leidos);
    // floor(1200 · 25000/30000 · 0,85) = 850 líneas, ≈ 21.250 tokens: cabe a la primera.
    expect(r.texto.split("\n\n")[0]!.split("\n")).toHaveLength(850);
    expect(r.texto.endsWith(
      "\n\n[Partial view — /index.html: lines 1-850 of 1200 (the file is 30000 tokens; one Read returns up to 25000). For the next part, Read with offset=851 limit=850, or Grep for the section you need. What you are looking for may be further down: do NOT base your answer on this part alone.]",
    )).toBe(true);
    expect(leidos.get("/index.html")).toMatchObject({ offset: 1, limit: 850, vistaParcial: true });
  });

  // ⚰️ Aquí se afirmaba que una línea de 120.000 caracteres se paginaba POR
  // CARACTERES (llegaban 85.000 con un cartel de vista parcial). Desde B
  // (01/10/2026, «como DeepSeek») cada línea se corta a 2.000 antes de contar,
  // así que esa línea llega cortada y entera en una sola lectura.
  it("líneas tan largas que no se podían paginar por línea: ahora llegan cortadas a 2.000", () => {
    const una = "z".repeat(120_000);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": una }), new Map());
    expect(r.texto).toBe(`1\t${"z".repeat(2000)}... (line truncated to 2000 chars)`);
  });

  it("los finales de línea CRLF se leen como LF", () => {
    const leidos: Leidos = new Map();
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "a\r\nb\r\n" }), leidos);
    expect(r.texto).toBe("1\ta\n2\tb\n3\t");
    expect(leidos.get("/index.html")?.instantanea).toBe("a\nb\n");
  });
});

// B (01/10/2026, decidido por Jesús: «como DeepSeek»). El arnés de DeepSeek
// corta cada línea a 2.000 caracteres al leer (`read-render.ts`,
// READ_MAX_LINE_LENGTH). Medido el 01/10: un favicon en base64 metido en una
// línea de 7.290 caracteres costó 20 vueltas a Len en el turno fbc761a9.
describe("Read corta las líneas largas, como DeepSeek", () => {
  const AVISO = "... (line truncated to 2000 chars)";

  it("una línea de más de 2.000 caracteres se corta, con el aviso de DeepSeek", () => {
    const larga = `<head>${"x".repeat(5000)}</head>`;
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": `<html>\n${larga}\n</html>` }), new Map());
    expect(r.texto).toBe(`1\t<html>\n2\t${larga.slice(0, 2000)}${AVISO}\n3\t</html>`);
  });

  it("una de 2.000 justos queda entera", () => {
    const justa = "y".repeat(2000);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": justa }), new Map());
    expect(r.texto).toBe(`1\t${justa}`);
  });

  it("el base64 de la línea larga ya no llega al modelo", () => {
    const linea = `<script data-ol-radius>${"a".repeat(6000)}</script><link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0i">`;
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": linea }), new Map());
    expect(r.texto).not.toContain("base64,");
  });

  it("🔴 cortar no deja la lectura como vista parcial: se puede editar el fichero igual", () => {
    const leidos: Leidos = new Map();
    const fichero = `${"z".repeat(3000)}\n<h1>Lume</h1>`;
    ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": fichero }), leidos);
    expect(leidos.get("/index.html")).toEqual({ instantanea: fichero, offset: 1, limit: undefined });
  });

  it("no parte un carácter en dos: si el corte cae en medio de un emoji, se queda fuera entero", () => {
    const linea = `${"a".repeat(1999)}😀${"b".repeat(10)}`;
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": linea }), new Map());
    expect(r.texto).toBe(`1\t${"a".repeat(1999)}${AVISO}`);
  });

  // Bajo el tope de bytes de siempre (256 KB, que no cambia): antes se paginaba
  // por caracteres y llegaban ~100.000.
  it("una página entera en una sola línea gigante ya no se pagina por caracteres: llega su principio, cortado", () => {
    const linea = "q".repeat(200_000);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": linea }), new Map());
    expect(r.texto).toBe(`1\t${"q".repeat(2000)}${AVISO}`);
  });
});
