import { describe, expect, it } from "vitest";
import { carpetaDe, carpetaDestino, estaDentro, moverRuta, nombreValido, paginaDe, rutaDentro } from "./explorador";
import { arbolDeFicheros } from "./arbol-de-ficheros";

describe("el explorador como el de VS Code — lo que no es pintar", () => {
  it("los nombres que valen son los de la carpeta del proyecto; `a/b.js` crea las de en medio", () => {
    for (const n of ["app.js", "util", "a/b.js", "Fecha_2.tsx", "datos.json"]) expect(nombreValido(n), n).toBe(true);
    for (const n of ["", " ", ".env", "con espacio.js", "a//b", "../x", "ñ.js", "a/"]) expect(nombreValido(n), n).toBe(false);
  });

  it("lo nuevo nace dentro de la carpeta elegida, junto al archivo elegido o en la raíz", () => {
    expect(carpetaDestino({ ruta: "/js", tipo: "carpeta" })).toBe("/js");
    expect(carpetaDestino({ ruta: "/js/app.js", tipo: "fichero" })).toBe("/js");
    expect(carpetaDestino({ ruta: "/index.html", tipo: "fichero" })).toBe("");
    expect(carpetaDestino(null)).toBe("");
    expect(rutaDentro("", "a.js")).toBe("/a.js");
    expect(rutaDentro("/js", "util/b.js")).toBe("/js/util/b.js");
    expect(carpetaDe("/js/util/b.js")).toBe("/js/util");
  });

  it("renombrar una carpeta mueve lo de dentro y nada más (`/js` no es `/jsx`)", () => {
    expect(moverRuta("/js/app.js", "/js", "/scripts")).toBe("/scripts/app.js");
    expect(moverRuta("/js", "/js", "/scripts")).toBe("/scripts");
    expect(moverRuta("/jsx/a.jsx", "/js", "/scripts")).toBe("/jsx/a.jsx");
    expect(estaDentro("/jsx/a", "/js")).toBe(false);
  });

  it("qué es una página: la portada y /<slug>/index.html", () => {
    expect(paginaDe("/index.html")).toBeNull();
    expect(paginaDe("/menu/index.html")).toBe("menu");
    expect(paginaDe("/a/b/index.html")).toBeUndefined();
    expect(paginaDe("/js/app.js")).toBeUndefined();
  });

  it("el árbol enseña una carpeta vacía recién creada", () => {
    const arbol = arbolDeFicheros([{ ruta: "/index.html" }, { ruta: "/css/nueva", carpeta: true }]);
    const css = arbol.find((n) => n.nombre === "css");
    expect(css?.tipo).toBe("carpeta");
    expect(css?.hijos.map((h) => [h.nombre, h.tipo])).toEqual([["nueva", "carpeta"]]);
  });
});
