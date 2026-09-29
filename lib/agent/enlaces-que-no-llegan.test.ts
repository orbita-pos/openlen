import { describe, it, expect } from "vitest";
import { enlacesQueNoLlegan, rutaLimpia } from "./enlaces-que-no-llegan";

// En pareja: el enlace que cae en la portada AVISA (🔴) y su forma buena CALLA.

const doc = (cuerpo: string) => `<!doctype html><html><body>${cuerpo}</body></html>`;
const tipos = (cuerpo: string) => enlacesQueNoLlegan(doc(cuerpo)).map((x) => x.tipo);

describe("rutaLimpia", () => {
  it("de un .html o una relativa, a la ruta de la página", () => {
    expect(rutaLimpia("menu.html")).toBe("/menu");
    expect(rutaLimpia("/menu/index.html")).toBe("/menu");
    expect(rutaLimpia("./contacto.html#mapa")).toBe("/contacto#mapa");
    expect(rutaLimpia("index.html")).toBe("/");
    expect(rutaLimpia("menu")).toBe("/menu");
  });
});

describe("enlacesQueNoLlegan", () => {
  it("🔴 sin esquema: instagram.com/juan es una ruta del propio sitio", () => {
    const r = enlacesQueNoLlegan(doc('<a href="instagram.com/juan">IG</a>'));
    expect(r).toEqual([{ tipo: "sin-esquema", href: "instagram.com/juan", sugerido: "https://instagram.com/juan" }]);
    expect(tipos('<a href="@juan">IG</a>')).toEqual(["sin-esquema"]);
  });
  it("con esquema, calla — también mailto:, tel: y wa.me completo", () => {
    expect(tipos('<a href="https://instagram.com/juan">IG</a><a href="mailto:a@b.mx">m</a><a href="tel:+523312345678">t</a>')).toEqual([]);
  });
  it("🔴 menu.html cae en la portada; /menu, no", () => {
    const r = enlacesQueNoLlegan(doc('<a href="menu.html">Menú</a>'));
    expect(r).toEqual([{ tipo: "con-html", href: "menu.html", sugerido: "/menu" }]);
    expect(tipos('<a href="/menu">Menú</a><a href="/menu/">Menú</a><a href="/">Inicio</a>')).toEqual([]);
  });
  it("🔴 una ruta sin «/» delante sólo funciona desde la portada", () => {
    expect(tipos('<a href="contacto">Contacto</a>')).toEqual(["relativa"]);
  });
  it("🔴 un ancla a un id que la página no tiene; con el id, calla", () => {
    expect(tipos('<a href="#precios">Ver precios</a>')).toEqual(["ancla-muerta"]);
    expect(tipos('<a href="#precios">Ver precios</a><section id="precios"></section>')).toEqual([]);
  });
  it("el # de un control, #top y un id que crea el script no son anclas muertas", () => {
    expect(tipos('<a href="#">Abrir</a><a href="#top">Subir</a>')).toEqual([]);
    expect(tipos('<a href="#carrito">Carrito</a><script>el.id = "carrito";</script>')).toEqual([]);
  });
  it("un % suelto en el ancla no lo tumba", () => {
    expect(() => enlacesQueNoLlegan(doc('<a href="#50%off">Oferta</a>'))).not.toThrow();
  });
});
