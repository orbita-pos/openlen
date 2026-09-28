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

  it("líneas tan largas que no se pueden paginar por línea: corta por caracteres y lo dice", () => {
    const una = "z".repeat(120_000);
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": una }), new Map());
    const [cuerpo, cartel] = r.texto.split("\n\n");
    // floor(25000 · 4 · 0,85) = 85.000 caracteres.
    expect(cuerpo).toBe("1\t" + "z".repeat(85_000));
    expect(cartel).toBe(
      "[Partial view — /index.html: the first 85000 of 120000 characters (the file is 30000 tokens; one Read returns up to 25000). Its lines are too long to split by line: Grep for the section you need, or Read with offset/limit to go through it. What you are looking for may be elsewhere: do NOT base your answer on this excerpt alone.]",
    );
  });

  it("los finales de línea CRLF se leen como LF", () => {
    const leidos: Leidos = new Map();
    const r = ejecutarRead({ file_path: "/index.html" }, sitio({ "/index.html": "a\r\nb\r\n" }), leidos);
    expect(r.texto).toBe("1\ta\n2\tb\n3\t");
    expect(leidos.get("/index.html")?.instantanea).toBe("a\nb\n");
  });
});
