import { describe, expect, it } from "vitest";
import { MAX_SUBIDA, extensionPermitida, planDeSubida } from "./subir-ficheros";

describe("subir archivos de tu ordenador al árbol", () => {
  it("se sube texto (código, CSS, JSON, SVG, Markdown) y páginas; una foto o un zip, no", () => {
    for (const n of ["app.js", "Boton.jsx", "base.css", "datos.json", "logo.svg", "LEEME.md", "index.html"]) expect(extensionPermitida(n), n).toBe(true);
    for (const n of ["foto.jpg", "x.png", "a.zip", "sin-extension", ".env"]) expect(extensionPermitida(n), n).toBe(false);
  });

  it("🔴 cada uno a su ruta dentro de la carpeta, con sus carpetas; lo que existe se marca para reemplazar", () => {
    const plan = planDeSubida(
      [
        { relativa: "app.js", tamano: 10 },
        { relativa: "css/base.css", tamano: 10 },
      ],
      "/src",
      new Set(["/src/app.js"]),
    );
    expect(plan.subir.map((s) => [s.ruta, s.reemplaza])).toEqual([
      ["/src/app.js", true],
      ["/src/css/base.css", false],
    ]);
    expect(plan.saltados).toEqual([]);
  });

  it("lo que no cabe se salta y se dice por qué", () => {
    const plan = planDeSubida(
      [
        { relativa: "foto.jpg", tamano: 10 },
        { relativa: "enorme.json", tamano: 2 * 1024 * 1024 },
        { relativa: "con espacio.js", tamano: 10 },
      ],
      "",
      new Set(),
    );
    expect(plan.subir).toEqual([]);
    expect(plan.saltados).toEqual([
      { nombre: "foto.jpg", motivo: "tipo" },
      { nombre: "enorme.json", motivo: "grande" },
      { nombre: "con espacio.js", motivo: "nombre" },
    ]);
  });

  it(`no más de ${MAX_SUBIDA} de una vez`, () => {
    const muchos = Array.from({ length: MAX_SUBIDA + 3 }, (_, i) => ({ relativa: `f${i}.js`, tamano: 1 }));
    const plan = planDeSubida(muchos, "", new Set());
    expect(plan.subir).toHaveLength(MAX_SUBIDA);
    expect(plan.saltados.map((s) => s.motivo)).toEqual(["demasiados", "demasiados", "demasiados"]);
  });
});
