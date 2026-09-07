import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { subpaginaPrompt } from "./subpagina-prompt";

const hecho = () =>
  subpaginaPrompt({
    portada: "<!doctype html><html lang=es><body>PORTADA DEL SITIO</body></html>",
    slug: "servicios",
    nombre: "Servicios",
    briefBlock: "BRIEF: Clínica veterinaria en Guadalajara",
  });

describe("el mensaje con el que se escribe una subpágina", () => {
  it("lleva la portada entera como referencia de diseño", () => {
    expect(hecho()).toContain("<sitio-existente>");
    expect(hecho()).toContain("PORTADA DEL SITIO");
  });

  it("dice qué página y en qué ruta", () => {
    expect(hecho()).toContain("«Servicios»");
    expect(hecho()).toContain("/servicios");
  });

  it("lleva el MISMO brief que recibió la portada", () => {
    expect(hecho()).toContain("Clínica veterinaria en Guadalajara");
  });

  // Lo que hace que la subpágina sea del MISMO sitio y no una página suelta. Si
  // alguna se cae, el sitio se despareja y NADIE lo mide: la subpágina saldría
  // "limpia" con otra tipografía y otro menú.
  it.each([
    ["el mismo head", /Mismo <head>/],
    ["la misma cabecera y el mismo pie", /misma cabecera y el mismo pie/],
    ["contenido nuevo, no el de la portada", /No repitas las secciones de la/],
    ["y sin inventarse más páginas", /No añadas páginas nuevas/],
  ])("conserva %s", (_, re) => {
    expect(hecho()).toMatch(re);
  });
});

// 🔴 UNA SOLA COPIA. Este módulo existe porque el prompt lo necesitan DOS
// superficies —la ruta `/api/generate`, que es producción, y el arnés de
// evals, que existe para medirla— y una segunda copia se desincroniza en
// SILENCIO: el arnés seguiría midiendo un prompt que ya no se envía, que es
// justo lo que la cabecera de `scripts/evals-pages.ts` prohíbe.
//
// La prueba mira el FICHERO y no el import, porque lo que hay que impedir es
// que alguien vuelva a pegar el literal ahí dentro.
describe("no puede haber una segunda copia", () => {
  it("🔴 la ruta llama a la función, no repite el literal", () => {
    const ruta = readFileSync("app/api/generate/route.ts", "utf8");
    expect(ruta).toContain("subpaginaPrompt(");
    expect(ruta, "el prompt volvió a la ruta: hay dos copias").not.toContain("<sitio-existente>");
  });

  it("🔴 el arnés de evals llama a la MISMA función", () => {
    const arnes = readFileSync("scripts/evals-pages.ts", "utf8");
    expect(arnes).toContain("subpaginaPrompt(");
    expect(arnes, "el arnés se hizo su propia copia").not.toContain("<sitio-existente>");
  });
});
