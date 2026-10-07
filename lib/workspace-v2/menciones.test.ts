import { describe, expect, it } from "vitest";

import { arrobaEnCurso, hayMencion, mencionesDe, opcionesDeMencion, ponerMencion } from "./menciones";

const GENTE = [
  { userId: "u-ana", nombre: "Ana López" },
  { userId: "u-luis", nombre: "Luis" },
  { userId: "u-correo", nombre: "jose@example.com" },
];

describe("las menciones de un comentario", () => {
  it("🔴 @Len y @Nombre exactos (sin distinguir mayúsculas), con espacios y correos", () => {
    expect(mencionesDe("@len pon esto en azul", GENTE)).toEqual({ len: true, personas: [] });
    expect(mencionesDe("@Ana López ¿y @luis? Ojo @jose@example.com", GENTE)).toEqual({ len: false, personas: ["u-ana", "u-luis", "u-correo"] });
    // Un correo cualquiera o una palabra que empieza igual NO es una mención.
    expect(mencionesDe("escribe a ana@lopez.com y a @Luisa", GENTE)).toEqual({ len: false, personas: [] });
    expect(mencionesDe("@Lento no es Len", GENTE).len).toBe(false);
    expect(hayMencion(mencionesDe("sin nadie", GENTE))).toBe(false);
  });

  it("el @ que se está escribiendo, sus opciones y ponerlo", () => {
    expect(arrobaEnCurso("hola @an", 8)).toEqual({ desde: 5, busca: "an" });
    expect(arrobaEnCurso("hola@an", 7)).toBeNull();
    expect(arrobaEnCurso("@", 1)).toEqual({ desde: 0, busca: "" });
    expect(opcionesDeMencion("", GENTE, true).map((o) => o.etiqueta)).toEqual(["Len", "Ana López", "Luis", "jose@example.com"]);
    expect(opcionesDeMencion("l", GENTE, false).map((o) => o.etiqueta)).toEqual(["Luis", "Ana López"]);
    expect(ponerMencion("hola @an que tal", 5, 8, "Ana López")).toEqual({ texto: "hola @Ana López  que tal", cursor: 16 });
  });
});
