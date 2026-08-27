// PIDES TRES PÁGINAS, TIENES TRES PÁGINAS.
//
// La junta entre lo que el modelo declara en su navegación y lo que se guarda.
// La portada de aquí abajo tiene la forma de una de verdad: <head> con tokens y
// tipografía, `<html>` con su temática, un menú, secciones, y un pie que repite
// los enlaces. Si esto se rompe, un usuario que pide una web de tres páginas
// vuelve a llevarse una — que es el fallo que esto vino a cerrar.
import { describe, expect, it } from "vitest";

import { construirPaginasDeclaradas } from "./construir-paginas-declaradas";

const PORTADA =
  '<!doctype html><html lang="es" data-ol-tematica="neon" style="--ol-accent:#f43f5e">' +
  "<head><title>Estudio Aguja Negra</title>" +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne">' +
  "<style>:root{--bg:#0b0b0f;--fg:#f7f7f8;--accent:#f43f5e}</style>" +
  "</head><body>" +
  '<header class="nav"><a href="/">Aguja Negra</a>' +
  '<nav><a href="/servicios">Servicios</a><a href="#trabajos">Trabajos</a>' +
  '<a href="/contacto">Contacto</a>' +
  '<a href="https://instagram.com/agujanegra">Instagram</a></nav></header>' +
  "<main><section><h1>Tinta que dura</h1></section>" +
  '<section id="trabajos"><h2>Trabajos</h2></section></main>' +
  '<footer><p>© 2026</p><a href="/contacto">Escríbenos</a></footer>' +
  "</body></html>";

describe("las páginas que la portada declara, construidas", () => {
  const paginas = construirPaginasDeclaradas(PORTADA);

  it("existen las dos que el menú enlaza, y sólo ésas", () => {
    expect(Object.keys(paginas).sort()).toEqual(["contacto", "servicios"]);
  });

  it("con el título que el modelo les puso", () => {
    expect(paginas.servicios!.title).toBe("Servicios");
    expect(paginas.contacto!.title).toBe("Contacto");
  });

  it("cada una es un documento completo", () => {
    for (const p of Object.values(paginas)) {
      expect(p.html.toLowerCase()).toContain("<!doctype html>");
      expect(p.html).toContain("</html>");
    }
  });

  /**
   * NACEN VESTIDAS. El look no se re-genera ni se copia a mano: se hereda del
   * <head> de la portada, que es lo que hace `buildPageShell` — la misma
   * función que usa el botón «Nueva página» desde junio. Una página nacida aquí
   * tiene que ser indistinguible de una creada a mano.
   */
  it("heredan la tipografía, los tokens y la temática de la portada", () => {
    const s = paginas.servicios!.html;
    expect(s).toContain("fonts.googleapis.com");
    expect(s).toContain("--accent:#f43f5e");
    expect(s).toContain('data-ol-tematica="neon"');
    expect(s).toContain('lang="es"');
  });

  it("y su menú y su pie, que es lo que hace que el sitio se navegue", () => {
    const s = paginas.servicios!.html;
    expect(s).toContain('href="/contacto"');
    expect(s).toContain("Aguja Negra");
    expect(s).toContain("© 2026");
  });

  it("con su propio <title>, no el de la portada", () => {
    expect(paginas.servicios!.html).toContain("<title>Servicios</title>");
    expect(paginas.servicios!.html).not.toContain("<title>Estudio Aguja Negra</title>");
  });

  it("pero NO el contenido de la portada", () => {
    expect(paginas.servicios!.html).not.toContain("Tinta que dura");
  });
});

describe("el caso normal: una sola página", () => {
  /**
   * LO IMPORTANTE DE ESTA PRUEBA. Casi todo cabe en una página con secciones, y
   * el modelo las enlaza con anclas. Si esto devolviera algo, CADA generación
   * normal se llenaría de subpáginas vacías que el usuario no pidió — un fallo
   * peor que el que esto arregla, porque le pasaría a todo el mundo.
   */
  it("un menú de anclas no crea ninguna página", () => {
    const unaSola = PORTADA.replace(/href="\/servicios"/, 'href="#servicios"').replace(
      /href="\/contacto"/g,
      'href="#contacto"',
    );
    expect(construirPaginasDeclaradas(unaSola)).toEqual({});
  });
});

describe("fail-soft: la portada es lo que el usuario vino a buscar", () => {
  it("un documento sin <body> no crea páginas, pero tampoco lanza", () => {
    expect(construirPaginasDeclaradas('<a href="/servicios">Servicios</a>')).toEqual({});
  });

  it("y una cadena vacía tampoco", () => {
    expect(construirPaginasDeclaradas("")).toEqual({});
  });
});
