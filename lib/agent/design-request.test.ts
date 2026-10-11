import { describe, expect, it } from "vitest";
import { parseDesignRequest } from "./design-request";

const FILES = { "/src/App.tsx": "a\nb\nc\nd\ne\nf\n<h1>Hola</h1>\n" };
const OK = { chain: [{ path: "/src/App.tsx", line: 7, component: null }], primary: 0, tag: "h1", text: "Hola", copies: 1, screen: "#/", changes: [{ property: "font-size", before: "32px", after: "48px" }] };

describe("parseDesignRequest", () => {
  it("acepta un elemento bien formado", () => {
    expect(parseDesignRequest({ elements: [OK] }, FILES)?.elements).toHaveLength(1);
  });
  it("🔴 descarta el elemento con una ruta que no existe, una línea fuera o una propiedad inventada; el resto sigue", () => {
    const malos = [
      { ...OK, chain: [{ path: "/src/NoExiste.tsx", line: 1, component: null }] },
      { ...OK, chain: [{ path: "/src/App.tsx", line: 999, component: null }] },
      { ...OK, changes: [{ property: "position", before: "", after: "fixed" }] },
      { ...OK, primary: 3 },
    ];
    expect(parseDesignRequest({ elements: [...malos, OK] }, FILES)?.elements).toHaveLength(1);
  });
  it("la cadena puede traer el sitio del lienzo (site): se acepta y no viaja a Len", () => {
    const r = parseDesignRequest({ elements: [{ ...OK, chain: [{ path: "/src/App.tsx", line: 7, component: null, site: "123:45" }] }] }, FILES);
    expect(r?.elements).toHaveLength(1);
    expect(r!.elements[0]!.chain[0]).toEqual({ path: "/src/App.tsx", line: 7, component: null });
  });

  it("sin cadena vale (va con su etiqueta y su texto)", () => {
    expect(parseDesignRequest({ elements: [{ ...OK, chain: [], primary: -1 }] }, FILES)?.elements).toHaveLength(1);
  });
  it("demasiado grande, o nada que hacer: null", () => {
    expect(parseDesignRequest({ elements: [OK], note: "x".repeat(70_000) }, FILES)).toBeNull();
    expect(parseDesignRequest({ elements: [{ ...OK, changes: [] }] }, FILES)).toBeNull();
    expect(parseDesignRequest("no", FILES)).toBeNull();
  });
  it("tope de 20 elementos", () => {
    expect(parseDesignRequest({ elements: Array.from({ length: 30 }, () => OK) }, FILES)?.elements).toHaveLength(20);
  });
});
