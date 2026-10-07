import { describe, expect, it } from "vitest";
import { parseStyleDirection } from "./parse-direction";

describe("parseStyleDirection — campo a campo, nada de confiar en la forma", () => {
  it("sin paleta válida no hay dirección", () => {
    expect(parseStyleDirection({})).toBeNull();
    expect(parseStyleDirection(null)).toBeNull();
    expect(parseStyleDirection({ styleDirection: { palette: [{ role: "bg", hex: "rojo" }] } })).toBeNull();
  });

  it("recorta la paleta a 6 y los roles a 24", () => {
    const palette = Array.from({ length: 9 }, (_, i) => ({ role: "r".repeat(40), hex: `#00000${i}` }));
    const d = parseStyleDirection({ styleDirection: { hostname: "x.com", palette, polarity: "light", fontFamily: "Inter", radius: "soft" } });
    expect(d?.palette).toHaveLength(6);
    expect(d?.palette[0]!.role).toHaveLength(24);
  });

  it("lo que no reconoce cae a su valor seguro, y el hostname del cliente no se cree", () => {
    const d = parseStyleDirection({
      styleDirection: { hostname: "malo.com", palette: [{ role: "bg", hex: "#112233" }], polarity: "neon", radius: "zigzag", character: "corto" },
    });
    expect(d).toEqual({ hostname: "", palette: [{ role: "bg", hex: "#112233" }], polarity: "light", fontFamily: "sans-serif", radius: "soft" });
  });
});
