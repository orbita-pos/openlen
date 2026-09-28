// lib/len-bench/casos/partir.test.ts
import { describe, expect, it } from "vitest";
import { enPagina, enTodas, partirEnPaginas } from "./partir";

const PLANTILLA = [
  '<header><a href="#">Logo</a><a href="#precios">Precios</a><a href="#contacto">Contacto</a></header>',
  '<!-- HERO --><section><h1>Hola</h1><a href="#contacto">Escríbenos</a></section>',
  '<!-- PRECIOS --><section id="precios"><p>$10</p></section>',
  '<!-- CONTACTO --><section id="contacto"><p>Tel</p></section>',
  "<!-- PIE --><footer>pie</footer>",
].join("\n");

const partido = () =>
  partirEnPaginas(PLANTILLA, {
    cabeceraHasta: "<!-- HERO -->",
    pieDesde: "<!-- PIE -->",
    paginas: [
      { slug: "", title: "Inicio", trozos: [["<!-- HERO -->", "<!-- PRECIOS -->"]] },
      { slug: "precios", title: "Precios", trozos: [["<!-- PRECIOS -->", "<!-- CONTACTO -->"]] },
      { slug: "contacto", title: "Contacto", trozos: [["<!-- CONTACTO -->", "<!-- PIE -->"]] },
    ],
  });

describe("partirEnPaginas — de una plantilla de una página, un sitio de varias", () => {
  it("cada página lleva la misma cabecera y el mismo pie, y SU trozo", () => {
    const d = partido();
    expect(d.html).toContain("<h1>Hola</h1>");
    expect(d.html).not.toContain("$10");
    expect(d.pages?.precios?.html).toContain("$10");
    for (const html of [d.html, d.pages?.precios?.html, d.pages?.contacto?.html]) {
      expect(html).toContain("<header>");
      expect(html).toContain("<footer>pie</footer>");
    }
  });
  it("los #ancla que quedan en OTRA página pasan a /pagina/#ancla (si no, el menú de la partida sería de botones muertos); los de la misma, no", () => {
    const d = partido();
    expect(d.html).toContain('href="/precios/#precios"');
    expect(d.html).toContain('href="/contacto/#contacto"');
    expect(d.pages?.contacto?.html).toContain('href="#contacto"');
    expect(d.html).toContain('href="#"');
  });
  it("sin home, o con una marca que ya no está, falla con nombre", () => {
    expect(() => partirEnPaginas(PLANTILLA, { cabeceraHasta: "<!-- HERO -->", pieDesde: "<!-- PIE -->", paginas: [] })).toThrow(/home/);
    expect(() =>
      partirEnPaginas(PLANTILLA, { cabeceraHasta: "<!-- NO -->", pieDesde: "<!-- PIE -->", paginas: [{ slug: "", title: "Inicio", trozos: [] }] }),
    ).toThrow(/<!-- NO -->/);
  });
});

describe("enTodas y enPagina — editar un sitio entero con `cambiar`", () => {
  it("enTodas cambia en cada página, cada una con su cuenta", () => {
    const d = enTodas(partido(), [["<footer>pie</footer>", "<footer>PIE</footer>"]]);
    for (const html of [d.html, d.pages?.precios?.html, d.pages?.contacto?.html]) expect(html).toContain("<footer>PIE</footer>");
  });
  it("enPagina cambia sólo en la que se dice, y una página que no existe es un error", () => {
    const d = enPagina(partido(), "precios", [["$10", "$12"]]);
    expect(d.pages?.precios?.html).toContain("$12");
    expect(d.html).not.toContain("$12");
    expect(() => enPagina(partido(), "blog", [["x", "y"]])).toThrow(/blog/);
  });
});
