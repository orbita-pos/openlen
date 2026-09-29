import { describe, expect, it } from "vitest";
import { coercerEntradaEdit, planearEdit } from "./edit";
import type { Leidos } from "./read";

// El contrato de Edit de Claude Code: ver plans/len-2/ficheros-plan.md §A.

const NOTA_ESTADO = " (what you sent is exactly what was saved: no need to Read it again)";

function sitio(ficheros: Record<string, string>) {
  return { contenido: (ruta: string) => ficheros[ruta] ?? null, ficheros: Object.keys(ficheros) };
}

/** Un fichero ya leído entero, tal y como lo apunta Read. */
function leido(ruta: string, contenido: string): Leidos {
  return new Map([[ruta, { instantanea: contenido, offset: 1, limit: undefined }]]);
}

const PAGINA = `<ul>\n  <li>Gorra — $250</li>\n  <li>Zapatillas — $1200</li>\n</ul>`;

describe("Edit: qué comprueba antes de tocar nada, en su orden", () => {
  it("old_string igual a new_string", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "a", new_string: "a" }, sitio({ "/index.html": "a" }), leido("/index.html", "a"));
    expect(r).toMatchObject({ ok: false, resultado: { error: "old_string and new_string are identical: there is nothing to change." } });
  });

  it("un fichero que no existe", () => {
    const r = planearEdit({ file_path: "/menu.html", old_string: "a", new_string: "b" }, sitio({ "/menu/index.html": "a" }), new Map());
    expect(r).toMatchObject({
      ok: false,
      resultado: { error: "There is no file at /menu.html. Paths start at the site root, /. Did you mean /menu/index.html?" },
    });
  });

  it("old_string vacío sobre un fichero con contenido", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "", new_string: "x" }, sitio({ "/index.html": "a" }), leido("/index.html", "a"));
    expect(r).toMatchObject({ ok: false, resultado: { error: "This file already has content, so old_string cannot be empty: pass the exact text you want to replace." } });
  });

  it("🔴 sin haberlo leído no se edita", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "Gorra", new_string: "Visera" }, sitio({ "/index.html": PAGINA }), new Map());
    expect(r).toMatchObject({
      ok: false,
      resultado: {
        texto: "<tool_use_error>You have not read this file in this conversation. Read it before changing it.</tool_use_error>",
      },
    });
  });

  it("una vista parcial (lectura que se paginó sola) no cuenta como leído", () => {
    const leidos: Leidos = new Map([["/index.html", { instantanea: PAGINA, offset: 1, limit: 2, vistaParcial: true }]]);
    const r = planearEdit({ file_path: "/index.html", old_string: "Gorra", new_string: "Visera" }, sitio({ "/index.html": PAGINA }), leidos);
    expect(r).toMatchObject({ ok: false, resultado: { error: "You have not read this file in this conversation. Read it before changing it." } });
  });

  it("…pero un tramo pedido con offset/limit SÍ cuenta (así lo hace Claude Code)", () => {
    const leidos: Leidos = new Map([["/index.html", { instantanea: PAGINA, offset: 2, limit: 1 }]]);
    const r = planearEdit({ file_path: "/index.html", old_string: "Gorra", new_string: "Visera" }, sitio({ "/index.html": PAGINA }), leidos);
    expect(r.ok).toBe(true);
  });

  it("🔴 cambió desde que lo leyó y el trozo ya no casa: que lo relea", () => {
    const ahora = PAGINA.replace("Gorra", "Boina");
    const r = planearEdit({ file_path: "/index.html", old_string: "Gorra — $250", new_string: "Gorra — $300" }, sitio({ "/index.html": ahora }), leido("/index.html", PAGINA));
    expect(r).toMatchObject({
      ok: false,
      resultado: { error: "This file changed after you read it (the user may have edited it). Read it again before changing it." },
    });
  });

  it("cambió desde que lo leyó pero el trozo sigue casando y es único: aplica y lo dice", () => {
    const ahora = PAGINA.replace("Zapatillas", "Tenis");
    const r = planearEdit({ file_path: "/index.html", old_string: "Gorra — $250", new_string: "Gorra — $300" }, sitio({ "/index.html": ahora }), leido("/index.html", PAGINA));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido).toBe(ahora.replace("$250", "$300"));
    expect(r.respuesta({ guardadoIgual: true })).toBe(
      "Edited /index.html. (note: the file had changed since your last Read of it. Your edit applied, but other parts differ from what you saw: Read it again before an edit that depends on what is around it.)",
    );
  });

  it("el trozo no está: lo dice, con la nota de \\uXXXX si lleva algo no-ASCII", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "Camiseta — $99", new_string: "x" }, sitio({ "/index.html": PAGINA }), leido("/index.html", PAGINA));
    expect(r).toMatchObject({
      ok: false,
      resultado: {
        error:
          "old_string is not in the file.\nold_string: Camiseta — $99\n(Edit also tried old_string with its \\uXXXX escapes turned into characters and the other way round; neither matched, so the difference is somewhere else. Read the file again and copy the text exactly.)",
      },
    });
  });

  it("…y sin la nota si es todo ASCII", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "Camiseta", new_string: "x" }, sitio({ "/index.html": PAGINA }), leido("/index.html", PAGINA));
    expect(r).toMatchObject({ ok: false, resultado: { error: "old_string is not in the file.\nold_string: Camiseta" } });
  });

  it("varias coincidencias sin replace_all", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "<li>", new_string: "<li class=x>" }, sitio({ "/index.html": PAGINA }), leido("/index.html", PAGINA));
    expect(r).toMatchObject({
      ok: false,
      resultado: {
        error:
          "old_string appears 2 times in the file. To change all of them, set replace_all to true; to change one, include more of the text around it so it matches only there.\nold_string: <li>",
      },
    });
  });
});

describe("Edit: cómo aplica", () => {
  it("🔴 quita la gorra y SÓLO la gorra: las zapatillas siguen ahí", () => {
    const r = planearEdit(
      { file_path: "/index.html", old_string: "  <li>Gorra — $250</li>\n", new_string: "" },
      sitio({ "/index.html": PAGINA }),
      leido("/index.html", PAGINA),
    );
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido).toBe(`<ul>\n  <li>Zapatillas — $1200</li>\n</ul>`);
    expect(r.respuesta({ guardadoIgual: true })).toBe(`Edited /index.html.${NOTA_ESTADO}`);
  });

  it("vaciar un trozo sin su salto de línea se lleva también el salto", () => {
    const r = planearEdit(
      { file_path: "/index.html", old_string: "  <li>Gorra — $250</li>", new_string: "" },
      sitio({ "/index.html": PAGINA }),
      leido("/index.html", PAGINA),
    );
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido).toBe(`<ul>\n  <li>Zapatillas — $1200</li>\n</ul>`);
  });

  it("replace_all cambia todas y lo dice con su frase", () => {
    const r = planearEdit(
      { file_path: "/index.html", old_string: "<li>", new_string: "<li class=x>", replace_all: true },
      sitio({ "/index.html": PAGINA }),
      leido("/index.html", PAGINA),
    );
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido.match(/<li class=x>/g)).toHaveLength(2);
    expect(r.respuesta({ guardadoIgual: true })).toBe(
      `Edited /index.html: every copy of old_string was replaced.${NOTA_ESTADO}`,
    );
  });

  it("si lo guardado no es lo que se mandó (la puerta añadió algo), no promete que su copia está al día", () => {
    const r = planearEdit({ file_path: "/index.html", old_string: "Gorra", new_string: "Visera" }, sitio({ "/index.html": PAGINA }), leido("/index.html", PAGINA));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.respuesta({ guardadoIgual: false })).toBe("Edited /index.html.");
  });

  it("repite la ruta tal como la escribió el modelo", () => {
    const r = planearEdit({ file_path: "index.html", old_string: "Gorra", new_string: "Visera" }, sitio({ "/index.html": PAGINA }), leido("/index.html", PAGINA));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.ruta).toBe("/index.html");
    expect(r.respuesta({ guardadoIgual: true })).toBe(`Edited index.html.${NOTA_ESTADO}`);
  });

  it("casa con comillas tipográficas del fichero y le pone tipográficas a lo nuevo", () => {
    const html = "<p>Dijo “ven” y fue</p>";
    const r = planearEdit({ file_path: "/index.html", old_string: 'Dijo "ven"', new_string: 'Dijo "vuelve"' }, sitio({ "/index.html": html }), leido("/index.html", html));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido).toBe("<p>Dijo “vuelve” y fue</p>");
  });

  it("casa un carácter con su escape \\uXXXX dentro del JavaScript y conserva la forma escapada", () => {
    const html = '<script>var t = "Caf\\u00e9";</script>';
    const r = planearEdit({ file_path: "/index.html", old_string: '"Café"', new_string: '"Café con leche"' }, sitio({ "/index.html": html }), leido("/index.html", html));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido).toBe('<script>var t = "Caf\\u00e9 con leche";</script>');
  });

  it("conserva los finales CRLF del fichero", () => {
    const html = "<ul>\r\n<li>a</li>\r\n</ul>";
    const r = planearEdit({ file_path: "/index.html", old_string: "<li>a</li>\n", new_string: "<li>b</li>\n" }, sitio({ "/index.html": html }), leido("/index.html", "<ul>\n<li>a</li>\n</ul>"));
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r.contenido).toBe("<ul>\r\n<li>b</li>\r\n</ul>");
  });

  it("con old_string vacío sobre un fichero que no existe, lo crea", () => {
    const r = planearEdit({ file_path: "/nosotros/index.html", old_string: "", new_string: "<h1>Nosotros</h1>" }, sitio({ "/index.html": "a" }), new Map());
    if (!r.ok) throw new Error(r.resultado.texto);
    expect(r).toMatchObject({ ok: true, crea: true, contenido: "<h1>Nosotros</h1>", ruta: "/nosotros/index.html" });
  });
});

describe("Edit: los nombres de parámetro de otros modelos", () => {
  it("path, old_str, new_str y replace_name", () => {
    expect(coercerEntradaEdit({ path: "/i.html", old_str: "a", new_str: "b", replace_name: "true" })).toEqual({
      file_path: "/i.html",
      old_string: "a",
      new_string: "b",
      replace_all: true,
    });
  });

  it("no pisa los nombres buenos", () => {
    expect(coercerEntradaEdit({ file_path: "/a", path: "/b", old_string: "x", new_string: "y" })).toEqual({
      file_path: "/a",
      old_string: "x",
      new_string: "y",
    });
  });
});
