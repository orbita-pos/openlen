// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CONNECTIONS_PAGE, pageConnections } from "./connections-page";

const all = Array.from({ length: 45 }, (_, i) => i);

describe("una página de conexiones", () => {
  it("la primera trae 20 y el cursor de la siguiente", () => {
    expect(CONNECTIONS_PAGE).toBe(20);
    expect(pageConnections(all)).toEqual({ items: all.slice(0, 20), nextCursor: "20" });
  });
  it("la última, sin cursor", () => {
    expect(pageConnections(all, "40")).toEqual({ items: all.slice(40), nextCursor: null });
  });
  it("un cursor raro empieza desde el principio", () => {
    for (const c of ["abc", "-5", "", null]) expect(pageConnections(all, c).items[0]).toBe(0);
  });
});
