import { describe, it, expect } from "vitest";
import {
  DESIGN_STASH_ATTR,
  parseStash,
  serializeStash,
  FACET_PROPS,
  facetOf,
} from "./design-stash";

describe("design-stash codec", () => {
  it("parsea el atributo y tolera basura", () => {
    expect(parseStash(null)).toEqual({});
    expect(parseStash("")).toEqual({});
    expect(parseStash("not json {{")).toEqual({});
    expect(parseStash('["array"]')).toEqual({});
    expect(parseStash('{"color":"#fff","x":3}')).toEqual({ color: "#fff" });
  });

  it("roundtrip serialize→parse; mapa vacío = null (quitar el atributo)", () => {
    expect(serializeStash({})).toBeNull();
    const map = { color: "", padding: "1rem" };
    expect(parseStash(serializeStash(map))).toEqual(map);
  });

  it("facetOf clasifica y devuelve null para props fuera de faceta", () => {
    expect(facetOf("font-size")).toBe("texto");
    expect(facetOf("padding")).toBe("espaciado");
    expect(facetOf("background-image")).toBe("estilo");
    expect(facetOf("z-index")).toBeNull();
  });

  it("el nombre del atributo es data-ol-was (data-ol-orig es de motion)", () => {
    expect(DESIGN_STASH_ATTR).toBe("data-ol-was");
  });

  it("las funciones inyectables no cierran sobre nada externo", () => {
    // eslint-disable-next-line no-eval
    const p = eval("(" + parseStash.toString() + ")");
    expect(p('{"a":"b"}')).toEqual({ a: "b" });
    // eslint-disable-next-line no-eval
    const s = eval("(" + serializeStash.toString() + ")");
    expect(s({ a: "b" })).toBe('{"a":"b"}');
  });
});
