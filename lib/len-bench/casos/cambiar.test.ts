// lib/len-bench/casos/cambiar.test.ts
import { describe, expect, it } from "vitest";
import { cambiar } from "./cambiar";

describe("cambiar — las ediciones a mano de una solución o una rota", () => {
  it("aplica cada cambio en orden", () => {
    expect(cambiar("<p>a</p><p>b</p>", [["<p>a</p>", "<p>A</p>"], ["<p>b</p>", "<p>B</p>"]])).toBe("<p>A</p><p>B</p>");
  });
  it("si un texto no está, LO DICE: un replace mudo deja la rota igual a la solución", () => {
    expect(() => cambiar("<p>a</p>", [["<p>zzz</p>", "x"]])).toThrow(/no encontré «<p>zzz<\/p>»/);
  });
  it("si un texto está más de una vez, también lo dice: no se sabe cuál se quería cambiar", () => {
    expect(() => cambiar("<p>a</p><p>a</p>", [["<p>a</p>", "x"]])).toThrow(/2 veces/);
  });
  it("con un número de veces, cambia TODAS si son exactamente ésas, y si no, lo dice", () => {
    expect(cambiar("tel 1 · tel 1 · tel 1", [["tel 1", "tel 2", 3]])).toBe("tel 2 · tel 2 · tel 2");
    expect(() => cambiar("tel 1 · tel 1", [["tel 1", "tel 2", 3]])).toThrow(/está 2 veces y se esperaban 3/);
  });
});
