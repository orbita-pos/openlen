// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ownTextOf, primaryOf } from "./canvas-functions";

describe("primaryOf", () => {
  it("el principal es el primer eslabón fuera de components/ui: el uso, no la definición", () => {
    expect(primaryOf([{ path: "/src/components/ui/button.tsx" }, { path: "/src/App.tsx" }])).toBe(1);
    expect(primaryOf([{ path: "/src/screens/Inicio.tsx" }])).toBe(0);
  });
  it("todo de components/ui: el primero; sin cadena: -1", () => {
    expect(primaryOf([{ path: "/src/components/ui/card.tsx" }, { path: "/src/components/ui/x.tsx" }])).toBe(0);
    expect(primaryOf([])).toBe(-1);
  });
});

describe("ownTextOf", () => {
  it("sólo el texto propio, sin el de los hijos, recortado", () => {
    const el = document.createElement("p");
    el.innerHTML = "Hola <b>mundo</b>   de verdad";
    expect(ownTextOf(el, 200)).toBe("Hola de verdad");
    expect(ownTextOf(el, 4)).toBe("Hola");
  });
});
