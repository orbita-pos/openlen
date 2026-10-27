import { describe, expect, it } from "vitest";

import { etiquetarConPosiciones } from "@/lib/agent/ficheros/posiciones";

import { buildPageEntries } from "./page-entries";

const parse = (h: string) => new DOMParser().parseFromString(h, "text/html");

function entriesOf(body: string, page: string | null = null, ruta = "/index.html") {
  const html = `<!doctype html>\n<html>\n<head><title>t</title></head>\n<body>\n${body}\n</body>\n</html>`;
  return buildPageEntries(etiquetarConPosiciones(html), page, ruta, parse);
}

describe("buildPageEntries", () => {
  it("lists every element with its source line, human name and the canvas path", () => {
    const entries = entriesOf(
      ['<section>', '  <h1>Pan de verdad</h1>', '  <div><a class="btn" href="#">Ver el mostrador</a></div>', "</section>"].join("\n"),
    );
    expect(entries.map((e) => e.tag)).toEqual(["section", "h1", "div", "a"]);
    const link = entries.find((e) => e.tag === "a")!;
    expect(link.line).toBe(7);
    expect(link.ruta).toBe("/index.html");
    expect(link.name).toBe("Ver el mostrador");
    expect(link.kind).toBe("link");
    expect(link.target).toEqual({
      type: "page",
      page: null,
      path: "section:nth-of-type(1) > div:nth-of-type(1) > a:nth-of-type(1)",
      tag: "a",
      text: "Ver el mostrador",
    });
    const div = entries.find((e) => e.tag === "div")!;
    expect(div.collapsed).toBe(true);
    expect(link.parent).toBe(div.key);
    const section = entries.find((e) => e.tag === "section")!;
    expect(section.name).toBe("Pan de verdad");
    expect(section.collapsed).toBe(false);
  });

  it("leaves out scripts and the insides of an svg, keeping the svg itself", () => {
    const entries = entriesOf('<p>hola</p>\n<script>var x = "<b>no</b>";</script>\n<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>');
    expect(entries.map((e) => e.tag)).toEqual(["p", "svg"]);
  });

  it("includes what is hidden on screen, because the index comes from the source", () => {
    const entries = entriesOf('<div style="display:none"><p>oculto</p></div>\n<dialog><button>Cerrar</button></dialog>');
    expect(entries.map((e) => e.tag)).toEqual(["div", "p", "dialog", "button"]);
  });

  it("reports the line where a multi-line element opens", () => {
    const entries = entriesOf('<a\n  href="#"\n  class="x">Ir</a>');
    expect(entries[0]!.line).toBe(5);
  });

  it("keeps the words apart across a <br> or an inline child", () => {
    const entries = entriesOf("<h1>Cada niña<br>que aprende <em>a</em> cambiar</h1>");
    expect(entries[0]!.name).toBe("Cada niña que aprende cambiar");
    expect(entries[0]!.target.text).toBe("Cada niña que aprende cambiar");
  });

  it("carries the page it belongs to", () => {
    const entries = entriesOf("<h2>Contacto</h2>", "contacto", "/contacto/index.html");
    expect(entries[0]!.target).toMatchObject({ page: "contacto" });
    expect(entries[0]!.ruta).toBe("/contacto/index.html");
  });
});
