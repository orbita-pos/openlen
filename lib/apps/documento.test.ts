// @vitest-environment node
// El index.html de una app (spec local 2026-10-07-apps, §5.1): el import map lo
// escribe la plataforma, va el primero, y no se lleva por delante el del dueño.
import { describe, expect, it } from "vitest";
import { conImportMap, conPrecarga, rutasDePrecarga } from "./documento";
import { CATALOGO_ACTUAL, importMapDe } from "./dependencias";

const DOC = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>App</title><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`;

function mapas(html: string): Array<{ imports?: Record<string, string> }> {
  return [...html.matchAll(/<script\b[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as { imports?: Record<string, string> });
}

describe("conImportMap", () => {
  it("pone el import map del catálogo el PRIMERO del <head>", () => {
    const html = conImportMap(DOC, CATALOGO_ACTUAL);
    expect(html.indexOf('type="importmap"')).toBeGreaterThan(html.indexOf("<head>"));
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf("<meta"));
    expect(mapas(html)).toEqual([importMapDe(CATALOGO_ACTUAL)]);
  });

  it("es idempotente", () => {
    const una = conImportMap(DOC, CATALOGO_ACTUAL);
    expect(conImportMap(una, CATALOGO_ACTUAL)).toBe(una);
  });

  it("🔴 el import map del dueño se FUSIONA, no se borra ni se duplica; en un choque gana el catálogo", () => {
    const conSuyo = DOC.replace(
      "</head>",
      '<script type="importmap">{"imports":{"util":"/src/lib/util.js","react":"https://otro.cdn/react.js"}}</script></head>',
    );
    const html = conImportMap(conSuyo, CATALOGO_ACTUAL);
    const todos = mapas(html);
    expect(todos).toHaveLength(1);
    expect(todos[0]!.imports!.util).toBe("/src/lib/util.js");
    expect(todos[0]!.imports!.react).toBe(importMapDe(CATALOGO_ACTUAL).imports.react);
  });

  it("uno que no es JSON se deja como está (el navegador lo dirá), y el nuestro va delante", () => {
    const roto = DOC.replace("</head>", '<script type="importmap">{ esto no es json</script></head>');
    const html = conImportMap(roto, CATALOGO_ACTUAL);
    expect(html).toContain("{ esto no es json");
    expect(html.indexOf("data-openlen-importmap")).toBeLessThan(html.indexOf("{ esto no es json"));
  });

  it("sin <head> ni <html>, va al principio", () => {
    expect(conImportMap('<div id="root"></div>', CATALOGO_ACTUAL).startsWith('<script type="importmap"')).toBe(true);
  });

  it("un </script> dentro del JSON no puede cerrar la etiqueta", () => {
    const conRaro = DOC.replace("</head>", '<script type="importmap">{"imports":{"x":"/a</script>.js"}}</script></head>');
    // El navegador cortaría el ajeno en su primer </script>; el nuestro no puede.
    const html = conImportMap(conRaro, CATALOGO_ACTUAL);
    const nuestro = /<script type="importmap" data-openlen-importmap>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(nuestro).not.toContain("</");
  });
});

describe("la precarga (modulepreload)", () => {
  it("rutasDePrecarga: fachadas usadas, el bundle de React y el grafo", () => {
    const rutas = rutasDePrecarga(CATALOGO_ACTUAL, ["/src/App.tsx", "/src/main.jsx"], ["react-dom/client", "react/jsx-runtime"]);
    expect(rutas).toEqual([
      `/openlen/vendor/${CATALOGO_ACTUAL}/react-dom-client.js`,
      `/openlen/vendor/${CATALOGO_ACTUAL}/react-jsx-runtime.js`,
      `/openlen/vendor/${CATALOGO_ACTUAL}/react-todo.js`,
      "/src/App.tsx",
      "/src/main.jsx",
    ]);
  });

  it("sin React no precarga el bundle de React", () => {
    expect(rutasDePrecarga(CATALOGO_ACTUAL, ["/src/main.js"], ["@supabase/supabase-js"])).toEqual([
      `/openlen/vendor/${CATALOGO_ACTUAL}/supabase-js.js`,
      "/src/main.js",
    ]);
  });

  it("conPrecarga: justo detrás del import map, e idempotente", () => {
    const conMapa = conImportMap(DOC, CATALOGO_ACTUAL);
    const html = conPrecarga(conMapa, ["/src/main.jsx", "/src/App.tsx"]);
    const finMapa = html.indexOf("</script>", html.indexOf("data-openlen-importmap"));
    expect(html.indexOf('rel="modulepreload" href="/src/main.jsx"')).toBeGreaterThan(finMapa);
    expect(html.indexOf('rel="modulepreload"')).toBeLessThan(html.indexOf("<meta"));
    expect(conPrecarga(html, ["/src/main.jsx", "/src/App.tsx"])).toBe(html);
    expect(conPrecarga(html, [])).toBe(conMapa);
  });
});
