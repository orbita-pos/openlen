import { describe, expect, it } from "vitest";
import { coercerEntradaWrite, planearWrite } from "./write";
import type { Leidos } from "./read";
import { MANUAL_SOLO_LECTURA } from "./manual";

// El contrato de Write de Claude Code: ver plans/len-2/ficheros-plan.md §A.

const NOTA_ESTADO = " (what you sent is exactly what was saved: no need to Read it again)";

function sitio(ficheros: Record<string, string>) {
  return { contenido: (ruta: string) => ficheros[ruta] ?? null, ficheros: Object.keys(ficheros) };
}

function leido(ruta: string, contenido: string): Leidos {
  return new Map([[ruta, { instantanea: contenido, offset: 1, limit: undefined }]]);
}

describe("Write", () => {
  it("🔴 /AGENTS.md es de solo lectura, aunque se haya leído", () => {
    const r = planearWrite({ file_path: "/AGENTS.md", content: "otra cosa" }, sitio({ "/AGENTS.md": "# manual" }), leido("/AGENTS.md", "# manual"));
    expect(r).toMatchObject({ ok: false, resultado: { error: MANUAL_SOLO_LECTURA } });
  });

  it("un fichero nuevo se crea sin haber leído nada", () => {
    const r = planearWrite({ file_path: "/nosotros/index.html", content: "<h1>Nosotros</h1>" }, sitio({ "/index.html": "x" }), new Map());
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r).toMatchObject({ ruta: "/nosotros/index.html", contenido: "<h1>Nosotros</h1>", crea: true });
    expect(r.respuesta({ guardadoIgual: true })).toBe(`Created /nosotros/index.html.${NOTA_ESTADO}`);
  });

  it("🔴 uno que existe no se sobrescribe sin haberlo leído", () => {
    const r = planearWrite({ file_path: "/index.html", content: "nuevo" }, sitio({ "/index.html": "viejo" }), new Map());
    expect(r).toMatchObject({
      ok: false,
      resultado: { texto: "<tool_use_error>You have not read this file in this conversation. Read it before changing it.</tool_use_error>" },
    });
  });

  it("ni con una vista parcial", () => {
    const leidos: Leidos = new Map([["/index.html", { instantanea: "viejo", offset: 1, limit: 1, vistaParcial: true }]]);
    const r = planearWrite({ file_path: "/index.html", content: "nuevo" }, sitio({ "/index.html": "viejo" }), leidos);
    expect(r).toMatchObject({ ok: false, resultado: { error: "You have not read this file in this conversation. Read it before changing it." } });
  });

  it("🔴 ni si cambió desde que lo leyó (aquí no hay recuperación, a diferencia de Edit)", () => {
    const r = planearWrite({ file_path: "/index.html", content: "nuevo" }, sitio({ "/index.html": "lo del dueño" }), leido("/index.html", "viejo"));
    expect(r).toMatchObject({
      ok: false,
      resultado: { error: "This file changed after you read it (the user may have edited it). Read it again before changing it." },
    });
  });

  it("leído y sin cambios: lo reescribe entero", () => {
    const r = planearWrite({ file_path: "/index.html", content: "nuevo" }, sitio({ "/index.html": "viejo" }), leido("/index.html", "viejo"));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r).toMatchObject({ contenido: "nuevo", crea: false });
    expect(r.respuesta({ guardadoIgual: true })).toBe(`Replaced the whole content of /index.html.${NOTA_ESTADO}`);
    expect(r.respuesta({ guardadoIgual: false })).toBe("Replaced the whole content of /index.html.");
  });

  it("los CRLF del fichero no cuentan como un cambio del dueño", () => {
    const r = planearWrite({ file_path: "/index.html", content: "nuevo" }, sitio({ "/index.html": "a\r\nb" }), leido("/index.html", "a\nb"));
    expect(r.ok).toBe(true);
  });

  it("un fichero que no es HTML no se puede crear, y no se inventa una sugerencia", () => {
    const r = planearWrite({ file_path: "/styles.css", content: "x" }, sitio({ "/index.html": "x" }), new Map());
    expect(r).toMatchObject({
      ok: false,
      resultado: { error: "Cannot create /styles.css: this site only has pages, at /index.html and /<slug>/index.html, and the data files of its declared stores, at /datos/<store>.json." },
    });
  });

  it("aquí sólo hay páginas: un fichero con otra forma no se puede crear, y se sugiere el que sí", () => {
    const r = planearWrite({ file_path: "/menu.html", content: "x" }, sitio({ "/index.html": "x" }), new Map());
    expect(r).toMatchObject({
      ok: false,
      resultado: {
        error:
          "Cannot create /menu.html: this site only has pages, at /index.html and /<slug>/index.html, and the data files of its declared stores, at /datos/<store>.json. Did you mean /menu/index.html?",
      },
    });
  });
});

describe("Write: los nombres de parámetro de otros modelos", () => {
  it("path y file_text, con la nota que lo explica", () => {
    expect(coercerEntradaWrite({ path: "/a/index.html", file_text: "x", description: "d" })).toEqual({
      entrada: { file_path: "/a/index.html", content: "x" },
      nota:
        "Note: Write takes `file_path` and `content`. `path` was taken as `file_path`. `file_text` was taken as `content`. `description` is not a parameter and was left out.",
    });
  });

  it("con los nombres buenos, sin nota", () => {
    expect(coercerEntradaWrite({ file_path: "/index.html", content: "x" })).toEqual({
      entrada: { file_path: "/index.html", content: "x" },
    });
  });

  it("si vienen file_text Y file_content no adivina cuál era el contenido", () => {
    expect(coercerEntradaWrite({ file_path: "/index.html", file_text: "a", file_content: "b" }).entrada.content).toBe("");
  });
});
