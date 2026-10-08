import { describe, expect, it } from "vitest";
import {
  abiertaEnAlguno,
  abrirEn,
  abrirEnNuevo,
  cerrarEn,
  dividir,
  MAX_GRUPOS,
  moverPestana,
  quitarDentro,
  renombrarEn,
  unGrupo,
} from "./grupos-de-editores";
import { destinoAlSoltar } from "./explorador";

describe("los grupos de editores, como en VS Code", () => {
  it("abrir en un grupo añade la pestaña (una vez) y lo hace activo", () => {
    let e = unGrupo(["/index.html"], "/index.html");
    e = abrirEn(e, 0, "/js/app.js");
    e = abrirEn(e, 0, "/index.html");
    expect(e).toEqual({ grupos: [{ pestanas: ["/index.html", "/js/app.js"], activa: "/index.html" }], activo: 0 });
  });

  it("«Dividir» pone el archivo activo también JUSTO a su derecha, hasta cuatro; sin sitio, lo lleva al de al lado", () => {
    let e = dividir(unGrupo(["/a.js", "/b.js"], "/b.js"), 0);
    expect(e).toEqual({
      grupos: [
        { pestanas: ["/a.js", "/b.js"], activa: "/b.js" },
        { pestanas: ["/b.js"], activa: "/b.js" },
      ],
      activo: 1,
    });
    // Dividir el PRIMERO con dos abiertos: el nuevo va entre los dos.
    e = abrirEn(e, 0, "/a.js");
    e = dividir(e, 0);
    expect(e.grupos.map((g) => g.activa)).toEqual(["/a.js", "/a.js", "/b.js"]);
    expect(e.activo).toBe(1);
    e = dividir(e, 2);
    expect(e.grupos).toHaveLength(MAX_GRUPOS);
    // Lleno: dividir el último lo abre en el de su izquierda.
    e = abrirEn(e, 3, "/c.js");
    e = dividir(e, 3);
    expect(e.grupos).toHaveLength(MAX_GRUPOS);
    expect(e.grupos[2]!.activa).toBe("/c.js");
    expect(e.activo).toBe(2);
  });

  it("abrir en un grupo nuevo (soltar en el borde) va a la derecha de todo; lleno, al último", () => {
    let e = abrirEnNuevo(unGrupo(["/a.js"], "/a.js"), "/b.js");
    expect(e.grupos.map((g) => g.pestanas)).toEqual([["/a.js"], ["/b.js"]]);
    expect(e.activo).toBe(1);
    e = abrirEnNuevo(abrirEnNuevo(e, "/c.js"), "/d.js");
    e = abrirEnNuevo(e, "/e.js");
    expect(e.grupos.map((g) => g.pestanas)).toEqual([["/a.js"], ["/b.js"], ["/c.js"], ["/d.js", "/e.js"]]);
  });

  it("🔴 reordenar dentro del mismo grupo: delante de la pestaña sobre la que se suelta, o al final", () => {
    let e = unGrupo(["/a", "/b", "/c", "/d"], "/a");
    e = moverPestana(e, 0, 0, "/d", "/b");
    expect(e.grupos[0]).toEqual({ pestanas: ["/a", "/d", "/b", "/c"], activa: "/d" });
    e = moverPestana(e, 0, 0, "/a", null);
    expect(e.grupos[0]!.pestanas).toEqual(["/d", "/b", "/c", "/a"]);
    // Soltarla sobre sí misma no la mueve.
    e = moverPestana(e, 0, 0, "/b", "/b");
    expect(e.grupos[0]!.pestanas).toEqual(["/d", "/b", "/c", "/a"]);
  });

  it("mover a otro grupo en un sitio concreto, o a uno nuevo (que no pasa de cuatro)", () => {
    let e = abrirEnNuevo(unGrupo(["/a", "/b"], "/a"), "/x");
    e = abrirEn(e, 1, "/y");
    e = moverPestana(e, 0, 1, "/b", "/y");
    expect(e.grupos[1]).toEqual({ pestanas: ["/x", "/b", "/y"], activa: "/b" });
    e = moverPestana(e, 1, 9, "/y");
    expect(e.grupos.map((g) => g.pestanas)).toEqual([["/a"], ["/x", "/b"], ["/y"]]);
    expect(e.activo).toBe(2);
  });

  it("cerrar la última pestaña de un grupo lo quita, y el otro queda activo", () => {
    let e = dividir(unGrupo(["/a.js"], "/a.js"), 0);
    e = abrirEn(e, 1, "/b.js");
    e = cerrarEn(e, 1, "/a.js");
    e = cerrarEn(e, 1, "/b.js");
    expect(e).toEqual({ grupos: [{ pestanas: ["/a.js"], activa: "/a.js" }], activo: 0 });
    // Cerrar la de en medio activa elige la de al lado.
    const f = cerrarEn(unGrupo(["/a", "/b", "/c"], "/b"), 0, "/b");
    expect(f.grupos[0]).toEqual({ pestanas: ["/a", "/c"], activa: "/c" });
  });

  it("mover una pestaña al otro grupo (o a uno nuevo a la derecha)", () => {
    let e = unGrupo(["/a.js", "/b.js"], "/a.js");
    e = moverPestana(e, 0, 1, "/b.js");
    expect(e.grupos).toEqual([
      { pestanas: ["/a.js"], activa: "/a.js" },
      { pestanas: ["/b.js"], activa: "/b.js" },
    ]);
    expect(e.activo).toBe(1);
    // Llevar la única del primero al segundo deja un solo grupo, con las dos.
    e = moverPestana(e, 0, 1, "/a.js");
    expect(e).toEqual({ grupos: [{ pestanas: ["/b.js", "/a.js"], activa: "/a.js" }], activo: 0 });
  });

  it("renombrar y borrar siguen a la ruta en todos los grupos", () => {
    let e = dividir(unGrupo(["/js/a.js", "/x.css"], "/js/a.js"), 0);
    e = renombrarEn(e, "/js", "/scripts");
    expect(e.grupos.map((g) => g.activa)).toEqual(["/scripts/a.js", "/scripts/a.js"]);
    expect(abiertaEnAlguno(e, "/scripts/a.js")).toBe(true);
    e = quitarDentro(e, "/scripts");
    expect(e).toEqual({ grupos: [{ pestanas: ["/x.css"], activa: "/x.css" }], activo: 0 });
  });
});

describe("arrastrar y soltar en el árbol", () => {
  it("a otra carpeta o a la raíz; nada si ya está ahí o si una carpeta caería dentro de sí misma", () => {
    expect(destinoAlSoltar("/js/app.js", "/src")).toBe("/src/app.js");
    expect(destinoAlSoltar("/js/app.js", "")).toBe("/app.js");
    expect(destinoAlSoltar("/app.js", "")).toBeNull();
    expect(destinoAlSoltar("/js/app.js", "/js")).toBeNull();
    expect(destinoAlSoltar("/js", "/js/util")).toBeNull();
    expect(destinoAlSoltar("/js", "/jsx")).toBe("/jsx/js");
  });
});
