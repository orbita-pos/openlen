import { describe, expect, it } from "vitest";
import { palabrasDelSubtitulo } from "./subtitulo";

describe("el subtítulo, palabra a palabra", () => {
  it("los números van en pastilla", () => {
    expect(palabrasDelSubtitulo("Llevas 312 visitas, 6 de 10.")).toEqual([
      { texto: "Llevas", clave: false },
      { texto: "312", clave: true },
      { texto: "visitas,", clave: false },
      { texto: "6", clave: true },
      { texto: "de", clave: false },
      { texto: "10.", clave: true },
    ]);
  });

  it("vacío → nada", () => {
    expect(palabrasDelSubtitulo("  ")).toEqual([]);
  });
});
