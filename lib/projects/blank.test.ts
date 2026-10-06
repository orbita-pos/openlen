import { describe, expect, it } from "vitest";
import { isBlankProject } from "./blank";

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
