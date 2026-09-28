import { describe, expect, it } from "vitest";
import {
  CWD,
  ficherosDelSitio,
  leerFichero,
  paginaDeRuta,
  resolverRuta,
  rutaDePagina,
  sugerirRuta,
} from "./sitio";

// El sitio, visto como ficheros: el MISMO árbol que escribe `publishToDir`
// (`index.html` y `<slug>/index.html`). Los ficheros viven en Postgres; esto es
// sólo la forma de nombrarlos.

const DATA = {
  html: "<html><body>home</body></html>",
  pages: {
    menu: { html: "<html><body>menu</body></html>" },
    contacto: { html: "<html><body>contacto</body></html>" },
  },
};

describe("rutas del sitio", () => {
  it("la home es /index.html y cada página su <slug>/index.html", () => {
    expect(rutaDePagina(null)).toBe("/index.html");
    expect(rutaDePagina("menu")).toBe("/menu/index.html");
  });

  it("la carpeta de trabajo es la raíz del sitio", () => {
    expect(CWD).toBe("/");
  });

  it("resuelve rutas relativas contra la raíz, como Claude Code", () => {
    expect(resolverRuta("index.html")).toBe("/index.html");
    expect(resolverRuta("./menu/index.html")).toBe("/menu/index.html");
    expect(resolverRuta("/menu//index.html")).toBe("/menu/index.html");
    expect(resolverRuta("menu\\index.html")).toBe("/menu/index.html");
    expect(resolverRuta("/menu/../index.html")).toBe("/index.html");
  });

  it("de una ruta sale su página, y lo que no es una página no es un fichero del sitio", () => {
    expect(paginaDeRuta("/index.html")).toEqual({ page: null });
    expect(paginaDeRuta("/menu/index.html")).toEqual({ page: "menu" });
    expect(paginaDeRuta("/menu.html")).toBeNull();
    expect(paginaDeRuta("/a/b/index.html")).toBeNull();
    expect(paginaDeRuta("/styles.css")).toBeNull();
  });

  it("lista los ficheros que existen: la home primero y las páginas por orden", () => {
    expect(ficherosDelSitio(DATA)).toEqual([
      "/index.html",
      "/contacto/index.html",
      "/menu/index.html",
    ]);
  });

  it("un proyecto sin home no tiene /index.html", () => {
    expect(ficherosDelSitio({ pages: { menu: { html: "x" } } })).toEqual(["/menu/index.html"]);
  });

  it("lee el contenido de un fichero, o null si no existe", () => {
    expect(leerFichero(DATA, "/index.html")).toBe(DATA.html);
    expect(leerFichero(DATA, "/menu/index.html")).toBe(DATA.pages.menu.html);
    expect(leerFichero(DATA, "/nosotros/index.html")).toBeNull();
    expect(leerFichero(DATA, "/menu.html")).toBeNull();
  });

  it("sugiere el fichero que seguramente quiso decir (el «Did you mean» de Claude Code)", () => {
    const ficheros = ficherosDelSitio(DATA);
    expect(sugerirRuta("/menu.html", ficheros)).toBe("/menu/index.html");
    expect(sugerirRuta("/menu", ficheros)).toBe("/menu/index.html");
    expect(sugerirRuta("/menu/", ficheros)).toBe("/menu/index.html");
    expect(sugerirRuta("/Menu/index.html", ficheros)).toBe("/menu/index.html");
    expect(sugerirRuta("/home/index.html", ficheros)).toBe("/index.html");
    expect(sugerirRuta("/nosotros/index.html", ficheros)).toBeUndefined();
  });
});
