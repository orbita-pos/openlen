// lib/len-bench/sse.test.ts
import { describe, expect, it } from "vitest";
import { crearLectorSse } from "./sse";

describe("crearLectorSse", () => {
  it("lee eventos con nombre y JSON", () => {
    const l = crearLectorSse();
    expect(l.empujar('event: text\ndata: {"text":"hola"}\n\n')).toEqual([{ nombre: "text", datos: { text: "hola" } }]);
  });
  it("junta un evento partido entre dos trozos", () => {
    const l = crearLectorSse();
    expect(l.empujar('event: done\ndata: {"tur')).toEqual([]);
    expect(l.empujar('ns":3}\n\n')).toEqual([{ nombre: "done", datos: { turns: 3 } }]);
  });
  it("tolera CRLF y deja el texto crudo si no es JSON", () => {
    const l = crearLectorSse();
    expect(l.empujar("event: x\r\ndata: no-json\r\n\r\n")).toEqual([{ nombre: "x", datos: "no-json" }]);
  });
  it("sin línea event: el nombre es message", () => {
    expect(crearLectorSse().empujar('data: {"a":1}\n\n')).toEqual([{ nombre: "message", datos: { a: 1 } }]);
  });
});
