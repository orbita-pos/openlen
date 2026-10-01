import { describe, expect, it } from "vitest";
import { destinoDelLogin } from "./destino";

describe("a dónde vuelve el login", () => {
  it("conserva la query: /llamada?project=… ya no se pierde", () => {
    expect(destinoDelLogin("/llamada", "?project=abc")).toBe("/llamada?project=abc");
    expect(destinoDelLogin("/movil/entrar", "?estado=x&retorno=app")).toBe("/movil/entrar?estado=x&retorno=app");
  });

  it("sin query, la ruta tal cual", () => {
    expect(destinoDelLogin("/new", "")).toBe("/new");
  });
});
