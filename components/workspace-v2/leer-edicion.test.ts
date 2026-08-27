// LA FRONTERA, PROBADA.
//
// `lib/page-engine/aplicar-ediciones.ts` tiene treinta y pico pruebas. El
// lector que decide QUÉ le llega no tenía ninguna, porque vivía dentro de
// `app/[locale]/new/page.tsx` y desde ahí no se puede importar nada sin
// arrastrar medio taller.
//
// Ahí estaba el hueco. El aplicador sabe quitar la hoja de tipografías vieja
// antes de poner la nueva —hay una prueba que lo dice, «deja UN solo <link>, no
// dos»— y el lector nunca le pasaba el dato que se lo pide. Peor: descartaba
// entera cualquier edición de cabeza con `html` vacío, que son exactamente las
// que BORRAN. Quitar el par de tipografías no quitaba nada, y no había forma de
// enterarse: la edición se tiraba en silencio, la petición salía bien, y el
// documento guardado seguía cargando la fuente de antes.
import { describe, expect, it } from "vitest";

import { claveDeEdicion, leerEdicion } from "./leer-edicion";

describe("lo que llega del iframe", () => {
  it("una edición de texto se lee entera", () => {
    const e = leerEdicion({
      type: "openlen:edit",
      op: "replace",
      path: "header:nth-of-type(1) > h1:nth-of-type(1)",
      tag: "h1",
      hijos: [],
      html: "<h1>Tinta que dura</h1>",
    });
    expect(e).not.toBeNull();
    expect(e?.op).toBe("replace");
  });

  it("y sin op se entiende como replace, que es lo que era antes", () => {
    const e = leerEdicion({ path: "p:nth-of-type(1)", tag: "p", hijos: [], html: "<p>x</p>" });
    expect(e?.op).toBe("replace");
  });

  it("lo que no tiene forma de edición se tira", () => {
    expect(leerEdicion(null)).toBeNull();
    expect(leerEdicion("hola")).toBeNull();
    expect(leerEdicion({ op: "inventada", path: "p", tag: "p", hijos: [] })).toBeNull();
    expect(leerEdicion({ op: "replace", tag: "p", hijos: [] })).toBeNull();
    expect(leerEdicion({ op: "replace", path: "p", tag: "p" })).toBeNull();
  });
});

describe("la cabeza, que es donde estaba el hueco", () => {
  it("lleva el atributo por el que se REEMPLAZA", () => {
    const e = leerEdicion({
      op: "cabeza",
      html: '<link rel="stylesheet" href="https://fonts.googleapis.com/x" data-ol-fonts="">',
      reemplazarPorAtributo: "data-ol-fonts",
    });
    expect(e).not.toBeNull();
    if (!e || e.op !== "cabeza") throw new Error("no es una edición de cabeza");
    expect(e.reemplazarPorAtributo).toBe("data-ol-fonts");
  });

  /**
   * LA PRUEBA DEL FALLO. Quitar el par de tipografías manda `html` vacío con el
   * atributo: «no pongas nada, y llévate lo que hubiera». El lector la tiraba
   * por venir vacía, así que el `<link>` viejo se quedaba para siempre.
   */
  it("html vacío CON atributo es la edición que sólo quita", () => {
    const e = leerEdicion({ op: "cabeza", html: "", reemplazarPorAtributo: "data-ol-fonts" });
    expect(e).not.toBeNull();
    if (!e || e.op !== "cabeza") throw new Error("no es una edición de cabeza");
    expect(e.html).toBe("");
    expect(e.reemplazarPorAtributo).toBe("data-ol-fonts");
  });

  it("y html vacío SIN atributo no es nada, y se tira", () => {
    expect(leerEdicion({ op: "cabeza", html: "" })).toBeNull();
  });
});

describe("los atributos de un elemento", () => {
  const base = {
    op: "atributos",
    path: "main:nth-of-type(1) > section:nth-of-type(1)",
    tag: "section",
    hijos: ["h2", "p"],
  };

  it("se leen con sus nombres y sus valores", () => {
    const e = leerEdicion({ ...base, attrs: { style: "color: red", "data-ol-reink": "" } });
    expect(e).not.toBeNull();
    if (!e || e.op !== "atributos") throw new Error("no es una edición de atributos");
    expect(e.attrs).toEqual({ style: "color: red", "data-ol-reink": "" });
  });

  /**
   * La cadena vacía NO es null. `data-ol-reink=""` es como la re-tinta anota
   * «este elemento no tenía color propio»; leerla como `null` la convertiría en
   * «quítalo» y la página se quedaría re-entintada sin forma de volver atrás.
   */
  it("la cadena vacía sobrevive, y null también — significan cosas distintas", () => {
    const e = leerEdicion({ ...base, attrs: { "data-ol-reink": "", "data-x": null } });
    if (!e || e.op !== "atributos") throw new Error("no es una edición de atributos");
    expect(e.attrs["data-ol-reink"]).toBe("");
    expect(e.attrs["data-x"]).toBeNull();
  });

  it("un valor que no es texto ni null se descarta", () => {
    const e = leerEdicion({ ...base, attrs: { style: "color: red", malo: { a: 1 } } });
    if (!e || e.op !== "atributos") throw new Error("no es una edición de atributos");
    expect(Object.keys(e.attrs)).toEqual(["style"]);
  });

  it("y sin ningún atributo legible no hay edición", () => {
    expect(leerEdicion({ ...base, attrs: {} })).toBeNull();
    expect(leerEdicion({ ...base, attrs: { a: 1, b: true } })).toBeNull();
  });
});

describe("qué edición sustituye a cuál", () => {
  it("escribir el mismo titular tres veces es UNA edición", () => {
    const clave = claveDeEdicion({
      op: "replace",
      path: "h1:nth-of-type(1)",
      tag: "h1",
      hijos: [],
      html: "<h1>a</h1>",
    });
    expect(clave).toBe("replace:h1:nth-of-type(1)");
  });

  it("una inserción y un borrado NO se colapsan — son acciones distintas", () => {
    expect(
      claveDeEdicion({
        op: "insert_after",
        path: "section:nth-of-type(1)",
        tag: "section",
        hijos: [],
        html: "<section></section>",
      }),
    ).toBeNull();
    expect(
      claveDeEdicion({ op: "delete", path: "section:nth-of-type(1)", tag: "section", hijos: [] }),
    ).toBeNull();
  });

  /**
   * EL COLAPSO QUE HABRÍA PERDIDO UN CAMBIO. Dos emisores escriben atributos de
   * `<html>`: el selector de tema pone `style` y `data-ol-mode`, y las
   * temáticas ponen `data-ol-tematica`. Colapsarlos por la operación a secas
   * dejaría que elegir un tema y luego una temática guardase sólo la segunda.
   */
  it("dos atributos_raiz que nombran cosas distintas NO se colapsan", () => {
    const tema = claveDeEdicion({
      op: "attrs_raiz",
      attrs: { style: "--ol-accent:#f00", "data-ol-mode": "dark" },
    });
    const tematica = claveDeEdicion({
      op: "attrs_raiz",
      attrs: { "data-ol-tematica": "neon", "data-ol-tematica-bg": "" },
    });
    expect(tema).not.toBe(tematica);
  });

  it("pero los MISMOS sí — volver a elegir tema no se acumula", () => {
    const uno = claveDeEdicion({ op: "attrs_raiz", attrs: { style: "a", "data-ol-mode": "dark" } });
    // El mismo par de nombres, en otro orden: es la misma edición.
    const dos = claveDeEdicion({ op: "attrs_raiz", attrs: { "data-ol-mode": "light", style: "b" } });
    expect(uno).toBe(dos);
  });

  it("y dos re-tintas del mismo elemento son el mismo cambio", () => {
    const uno = claveDeEdicion({
      op: "atributos",
      path: "section:nth-of-type(2) > p:nth-of-type(1)",
      tag: "p",
      hijos: [],
      attrs: { style: "color: a", "data-ol-reink": "" },
    });
    const dos = claveDeEdicion({
      op: "atributos",
      path: "section:nth-of-type(2) > p:nth-of-type(1)",
      tag: "p",
      hijos: [],
      attrs: { style: "color: b", "data-ol-reink": "" },
    });
    expect(uno).toBe(dos);
    expect(uno).not.toBeNull();
  });

  it("la cabeza NUNCA se colapsa: dos turnos pueden traer cosas distintas", () => {
    expect(claveDeEdicion({ op: "cabeza", html: "<title>a</title>" })).toBeNull();
  });
});
