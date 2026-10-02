// lib/len-bench/web-sustituta.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { WebDelCaso } from "./tipos";
import { buscarEnLaWeb, leerDeLaWeb, problemasDeLaWeb, textoDeLaWeb } from "./web-sustituta";

const MUSEO = { titulo: "Museo de la Sal Vieja — Visita", url: "https://museosalvieja.es/visita", fragmento: "Martes a domingo, de 10:00 a 17:30.", fecha: "2026-03-02" };
const BLOG = { titulo: "Qué ver en el norte", url: "https://blog.example/norte", fragmento: "abre de 9 a 17 h", fecha: "2019-07-14" };

const WEB: WebDelCaso = {
  busquedas: [
    { si: /sal vieja/i, resultados: [MUSEO, BLOG] },
    { si: /museo/i, resultados: [BLOG] },
  ],
  paginas: {
    "https://museosalvieja.es/visita": "<main><h1>Visita</h1><p>Martes a domingo, de 10:00 a 17:30. Lunes cerrado.</p><script>var x = 1</script></main>",
    "https://blog.example/norte": "<p>El museo abre de 9 a 17 h.</p>",
  },
};

describe("buscarEnLaWeb", () => {
  it("la primera regla que casa con la consulta da sus resultados, en su orden", () => {
    expect(buscarEnLaWeb(WEB, "horario del Museo de la Sal Vieja 2026")).toEqual([MUSEO, BLOG]);
    expect(buscarEnLaWeb(WEB, "museos de Ibiza")).toEqual([BLOG]);
  });
  it("una consulta de otra cosa, o un caso sin web, no encuentra nada", () => {
    expect(buscarEnLaWeb(WEB, "precio del café de enfrente")).toEqual([]);
    expect(buscarEnLaWeb(undefined, "sal vieja")).toEqual([]);
  });
});

describe("leerDeLaWeb", () => {
  it("encuentra la página escrita de otra forma: www, http, barra final o ancla", () => {
    for (const u of ["https://museosalvieja.es/visita", "http://www.museosalvieja.es/visita/", "https://MuseoSalVieja.es/visita#horario"]) {
      expect(leerDeLaWeb(WEB, u)).toContain("Lunes cerrado");
    }
  });
  it("lo que no está en la web no existe, y lo que no es http tampoco", () => {
    expect(leerDeLaWeb(WEB, "https://museosalvieja.es/tienda")).toBeNull();
    expect(leerDeLaWeb(WEB, "file:///etc/passwd")).toBeNull();
    expect(leerDeLaWeb(WEB, "no es una url")).toBeNull();
    expect(leerDeLaWeb(undefined, "https://museosalvieja.es/visita")).toBeNull();
  });
});

describe("textoDeLaWeb", () => {
  it("junta resultados y el texto VISIBLE de cada página, sin sus scripts", () => {
    const t = textoDeLaWeb(WEB);
    expect(t).toContain("Lunes cerrado");
    expect(t).toContain("abre de 9 a 17 h");
    expect(t).toContain("Qué ver en el norte");
    expect(t).not.toContain("var x");
    expect(textoDeLaWeb(undefined)).toBe("");
  });
});

describe("problemasDeLaWeb", () => {
  it("un resultado que lleva a una página que la web no tiene se dice", () => {
    expect(problemasDeLaWeb(WEB)).toEqual([]);
    const rota: WebDelCaso = { ...WEB, paginas: { "https://blog.example/norte": "<p>x</p>" } };
    expect(problemasDeLaWeb(rota)).toEqual([
      "el resultado «Museo de la Sal Vieja — Visita» lleva a https://museosalvieja.es/visita, que no está en sus páginas",
    ]);
  });
});
