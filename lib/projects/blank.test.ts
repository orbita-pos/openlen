import { describe, expect, it } from "vitest";
import { isBlankProject, visibleProjects } from "./blank";

describe("isBlankProject — como la «New Session» de DeepSeek", () => {
  it("sin portada, sin páginas y sin conversación: en blanco", () => {
    expect(isBlankProject({ html: "", pages: {}, chatTurns: 0 })).toBe(true);
    expect(isBlankProject({ html: null, pages: undefined, chatTurns: 0 })).toBe(true);
    expect(isBlankProject({ html: "  \n", pages: null, chatTurns: 0 })).toBe(true);
  });
  it("🔴 con conversación NO está en blanco aunque no haya HTML: es del usuario", () => {
    expect(isBlankProject({ html: "", pages: {}, chatTurns: 1 })).toBe(false);
  });
  it("con portada o con una página, no", () => {
    expect(isBlankProject({ html: "<h1>Hola</h1>", pages: {}, chatTurns: 0 })).toBe(false);
    expect(isBlankProject({ html: "", pages: { menu: { html: "x" } }, chatTurns: 0 })).toBe(false);
  });
});

describe("visibleProjects — los blancos no salen, salvo el abierto", () => {
  const lista = [
    { id: "a", isBlank: false },
    { id: "b", isBlank: true },
    { id: "c", isBlank: true },
    { id: "d" },
  ];
  it("sin proyecto abierto, ningún blanco", () => {
    expect(visibleProjects(lista, null).map((p) => p.id)).toEqual(["a", "d"]);
  });
  it("el blanco abierto sí sale", () => {
    expect(visibleProjects(lista, "c").map((p) => p.id)).toEqual(["a", "c", "d"]);
  });
});
