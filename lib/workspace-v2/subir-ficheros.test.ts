import { describe, expect, it } from "vitest";
import { MAX_SUBIDA, planDeSubida } from "./subir-ficheros";

describe("subir archivos de tu ordenador al árbol", () => {
  it("se sube cualquier archivo, como a un disco (spec local 2026-10-28): fotos, fuentes, un zip, sin extensión", () => {
    const nombres = ["app.js", "foto.jpg", "x.png", "fuente.woff2", "a.zip", "sin-extension", ".env", "index.html"];
    const plan = planDeSubida(nombres.map((relativa) => ({ relativa, tamano: 10 })), "", new Set());
    expect(plan.subir.map((s) => s.ruta)).toEqual(nombres.map((n) => `/${n}`));
    expect(plan.saltados).toEqual([]);
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
        { relativa: "enorme.mp4", tamano: 50 * 1024 * 1024 + 1 },
        { relativa: "a//b.js", tamano: 10 },
      ],
      "",
      new Set(),
    );
    expect(plan.subir).toEqual([]);
    expect(plan.saltados).toEqual([
      { nombre: "enorme.mp4", motivo: "grande" },
      { nombre: "a//b.js", motivo: "nombre" },
    ]);
  });

  it(`no más de ${MAX_SUBIDA} de una vez`, () => {
    const muchos = Array.from({ length: MAX_SUBIDA + 3 }, (_, i) => ({ relativa: `f${i}.js`, tamano: 1 }));
    const plan = planDeSubida(muchos, "", new Set());
    expect(plan.subir).toHaveLength(MAX_SUBIDA);
    expect(plan.saltados.map((s) => s.motivo)).toEqual(["demasiados", "demasiados", "demasiados"]);
  });
});
