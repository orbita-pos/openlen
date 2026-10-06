import { describe, expect, it } from "vitest";
import { createWritePreview, readPartialWrite } from "./write-preview";

describe("readPartialWrite — el Write a medias", () => {
  it("lee la ruta y el contenido de unos argumentos enteros", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<h1>Hola</h1>"}')).toEqual({
      filePath: "/index.html",
      content: "<h1>Hola</h1>",
    });
  });

  it("un contenido cortado se lee hasta donde llegó", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<h1>Ho')).toEqual({
      filePath: "/index.html",
      content: "<h1>Ho",
    });
  });

  it("🔴 una barra sola al final no se pinta: es medio escape", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<p>a\\').content).toBe("<p>a");
  });

  it("🔴 un \\u a medias tampoco; entero, sí", () => {
    expect(readPartialWrite('{"file_path":"/x/index.html","content":"caf\\u00e').content).toBe("caf");
    expect(readPartialWrite('{"file_path":"/x/index.html","content":"caf\\u00e9"}').content).toBe("café");
  });

  it("decodifica comillas, saltos y barras", () => {
    expect(readPartialWrite('{"file_path":"/index.html","content":"<a href=\\"/\\">\\n</a>\\\\"}').content).toBe(
      '<a href="/">\n</a>\\',
    );
  });

  it("si el contenido llega ANTES que la ruta, la ruta es null hasta que llegue", () => {
    expect(readPartialWrite('{"content":"<h1>Hola</h1>","file_pa')).toEqual({ filePath: null, content: "<h1>Hola</h1>" });
  });

  it("una ruta sin cerrar no es una ruta", () => {
    expect(readPartialWrite('{"file_path":"/ind').filePath).toBeNull();
  });

  it("sin contenido todavía: null, no cadena vacía", () => {
    expect(readPartialWrite('{"file_path":"/index.html",').content).toBeNull();
  });
});

describe("createWritePreview — cuándo se pinta", () => {
  const html = (n: number) => "<p>" + "x".repeat(n);

  it("un Write de una página pinta cada `step` caracteres nuevos", () => {
    const p = createWritePreview(10);
    expect(p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/index.html","content":"' })).toBeNull();
    expect(p.push({ index: 0, argsDelta: html(4) })).toBeNull(); // 7 < 10
    expect(p.push({ index: 0, argsDelta: "yyyy" })).toEqual({ page: null, html: html(4) + "yyyy" }); // 11
    expect(p.push({ index: 0, argsDelta: "z" })).toBeNull(); // +1
  });

  it("la página la dice la ruta: /menu/index.html es «menu»", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/menu/index.html","content":"' });
    expect(p.push({ index: 0, argsDelta: "<h1>" })).toEqual({ page: "menu", html: "<h1>" });
  });

  it("🔴 un Write que no es de una página no pinta nada", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/js/app.js","content":"' });
    expect(p.push({ index: 0, argsDelta: "const a = 1;" })).toBeNull();
  });

  it("otra herramienta no pinta aunque traiga `content`", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Edit", argsDelta: '{"file_path":"/index.html","content":"' });
    expect(p.push({ index: 0, argsDelta: "<h1>" })).toBeNull();
  });

  it("dos llamadas en paralelo se leen por su índice", () => {
    const p = createWritePreview(1);
    p.push({ index: 0, name: "Write", argsDelta: '{"file_path":"/index.html","content":"' });
    p.push({ index: 1, name: "Write", argsDelta: '{"file_path":"/menu/index.html","content":"' });
    expect(p.push({ index: 1, argsDelta: "B" })).toEqual({ page: "menu", html: "B" });
    expect(p.push({ index: 0, argsDelta: "A" })).toEqual({ page: null, html: "A" });
  });
});
